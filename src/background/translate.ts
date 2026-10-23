/**
 * background/translate.ts — translate() 唯一入口管线（契约 ARCHITECTURE.md §7）。
 *
 *   cache.get → mask → glossary → 引擎路由（免费链冷却降级 / BYOK 单发 /
 *   supportsBatch + batch.enabled 走 BatchQueue）→ restore glossary → restore PII
 *   → cache.set（key 含 promptSig=glossarySignature，术语表变更即失效）
 *
 * 免费链（OpenImmersive 式）：配置引擎优先，失败冷却 60s 沉底，依次尝试
 * FREE_CHAIN 其余引擎，全失败抛合并错误；BYOK 不进链（配置错误不静默掩盖）。
 */

import type { Config } from '../shared/config'
import type { AiChatMessage } from '../shared/protocol'
import { maskSensitive, restoreSensitive, type MaskEntity } from '../core/mask'
import {
  applyGlossary,
  restoreGlossary,
  glossarySignature,
  type GlossaryEntity,
  type GlossaryTerm,
} from '../core/glossary'
import { textHash } from '../core/text'
import { scriptStats } from '../core/detect'
import { langName } from '../core/langs'
import { BUILTIN_EXPERTS } from '../core/experts'
import { ENGINES, FREE_CHAIN, resolveEngine, AIMAO_ENDPOINT } from './engines'
import type { Engine, EngineContext, EngineResult } from './engines'
import { getFetch } from './engines/fetch'
import { cacheKey, get as cacheGet, set as cacheSet } from './cache'
import { getBatchQueue } from './batch'
import { resolveEffectiveGlossary } from './glossaryLibs'

export interface TranslateOptions {
  targetLang: string
  sourceLang?: string
  /** 页面摘要上下文（content 侧 getPageContext 提取）：仅 AI 引擎注入 system prompt */
  context?: string
}

// ── 免费链冷却（模块级 Map：engineId → 过期时间戳）───────────────────────────

const COOLDOWN_MS = 60_000
const cooldowns = new Map<string, number>()

/** 清空冷却表（测试用）。 */
export function resetCooldowns(): void {
  cooldowns.clear()
}

function isCooling(id: string, now: number): boolean {
  const until = cooldowns.get(id)
  return until !== undefined && until > now
}

// ── mask / glossary 预处理的正逆实现 ─────────────────────────────────────────

interface Prepared {
  text: string
  maskEntities: MaskEntity[]
  glossEntities: GlossaryEntity[]
}

/** 正序：mask → glossary（占位符发送给引擎）。terms 为 resolveEffectiveGlossary 合并后的有效术语。 */
function prepare(text: string, config: Config, terms: GlossaryTerm[]): Prepared {
  let maskEntities: MaskEntity[] = []
  let t = text
  if (config.mask.enabled) {
    const m = maskSensitive(t)
    t = m.masked
    maskEntities = m.entities
  }
  let glossEntities: GlossaryEntity[] = []
  if (terms.length > 0) {
    const g = applyGlossary(t, terms)
    t = g.text
    glossEntities = g.entities
  }
  return { text: t, maskEntities, glossEntities }
}

/** 逆序：restore glossary → restore PII（占位符文本即 key，容错正则）。 */
function restorePrepared(prep: Prepared, translated: string): string {
  return restoreSensitive(restoreGlossary(translated, prep.glossEntities), prep.maskEntities)
}

function sigOf(terms: GlossaryTerm[]): string {
  return glossarySignature(terms)
}

// ── 全页摘要上下文感知（仅 AI 引擎生效）─────────────────────────────────────

/** AI 类 provider：openai/deepseek/claude/gemini/aimao。 */
const AI_PROVIDERS = new Set(['openai', 'deepseek', 'claude', 'gemini', 'aimao'])

/**
 * 是否 AI 类 provider（aiAssist / aiChat / aiWrite 共用的准入判定）：
 * 内置 AI 名单（openai/deepseek/claude/gemini/aimao），或 custom:<id> 动态
 * 自定义引擎实例（OpenAI 兼容协议，天然是 AI 引擎）。
 */
export function isAiProvider(provider: string): boolean {
  return AI_PROVIDERS.has(provider) || provider.startsWith('custom:')
}

/**
 * 是否 AI 类引擎：provider 命中 AI 判定，或引擎声明 supportsBatch（编号 JSON
 * 批协议只有 LLM 引擎实现）。用 ENGINES 直查而不用 resolveEngine——后者对
 * 缺 key 的 BYOK 会抛，不能在缓存查询前改变既有行为。
 */
function isAiEngine(providerId: string): boolean {
  return isAiProvider(providerId) || !!ENGINES[providerId]?.supportsBatch
}

/** 注入 system prompt 的页面上下文块（导出供单测断言）。 */
export function pageContextBlock(context: string): string {
  return (
    `<page_context>\n${context}\n</page_context>\n` +
    'Use it only to resolve references and terminology; do not translate it.'
  )
}

/**
 * 把页面上下文注入激活专家的 systemPrompt（translate.ts 层做 prompt 构造，
 * 不动 openaiCompat.ts）：引擎 buildSystemPrompt 以 `${expert.systemPrompt} ...`
 * 开头，因此把上下文块前置到激活专家的 systemPrompt 即进入最终 system prompt。
 * 激活 id 不在 list 时引擎回退内置 general——此时改写/补种 general 条目保证命中。
 */
function withPageContext(config: Config, context: string): Config {
  const block = pageContextBlock(context)
  const experts = config.experts
  const list = Array.isArray(experts?.list) ? experts.list : []
  const activeId = experts?.activeId ?? 'general'
  const targetId = list.some((e) => e.id === activeId) ? activeId : 'general'
  const inject = (systemPrompt: string) => `${block}\n\n${systemPrompt}`
  let nextList = list.map((e) =>
    e.id === targetId ? { ...e, systemPrompt: inject(e.systemPrompt) } : e,
  )
  if (!nextList.some((e) => e.id === targetId)) {
    nextList = [...nextList, { ...BUILTIN_EXPERTS[0], systemPrompt: inject(BUILTIN_EXPERTS[0].systemPrompt) }]
  }
  return { ...config, experts: { ...experts, activeId: targetId, list: nextList } }
}

/** 归一化 opts.context：trim 后为空视为无；仅 AI 引擎保留（机器引擎忽略）。 */
function effectiveContext(opts: TranslateOptions, providerId: string): string | undefined {
  const ctx = opts.context?.trim()
  if (!ctx) return undefined
  return isAiEngine(providerId) ? ctx : undefined
}

/**
 * 缓存 key：promptSig = 有效术语签名；有页面上下文时追加 `ctx:textHash(context)`，
 * 不同页面（上下文不同）的同文翻译不串缓存；无上下文时 key 与旧版完全一致。
 */
function keyFor(
  engineId: string,
  from: string,
  to: string,
  text: string,
  terms: GlossaryTerm[],
  context?: string,
): string {
  const sig = context ? `${sigOf(terms)}|ctx:${textHash(context)}` : sigOf(terms)
  return cacheKey({ engine: engineId, from, to, text, promptSig: sig })
}

// ── 引擎路由 ────────────────────────────────────────────────────────────────

/** 单次引擎调用的超时控制：超时按引擎失败处理（免费链据此降级）。 */
function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fn(controller.signal).finally(() => clearTimeout(timer))
}

/** 免费链：配置引擎优先，失败冷却 60s 沉底，依次尝试 FREE_CHAIN 其余。 */
async function translateFreeChain(
  text: string,
  from: string,
  to: string,
  config: Config,
  preferred: Engine,
): Promise<EngineResult> {
  const order = [preferred.id, ...FREE_CHAIN.filter((id) => id !== preferred.id)]
  const errors: string[] = []
  const now = Date.now()
  for (const id of order) {
    if (isCooling(id, now)) continue
    try {
      return await withTimeout(
        (signal) => ENGINES[id].translate(text, from, to, { config }, signal),
        config.engine.timeoutMs,
      )
    } catch (err) {
      cooldowns.set(id, Date.now() + COOLDOWN_MS)
      errors.push(`${id}: ${(err as Error).message}`)
    }
  }
  throw new Error(`translate: all free engines failed (${errors.join(' | ')})`)
}

/**
 * BYOK 引擎的端点可能指向用户自建的任意域名（自定义接口/自托管/代理），
 * 这些不在 manifest 的 host_permissions 里，需要用户在设置页通过
 * optional_host_permissions 显式授权（权限最小化原则）。
 */
/**
 * 当前 provider 的端点 URL（导出供单测断言各分支）。
 * custom:<id> 动态实例从 config.engine.customEngines 查 entry.endpoint；
 * 查不到（配置未同步/已删除）返回 null，跳过权限检查（路由阶段 resolveEngine 会先抛）。
 */
export function endpointUrlOf(config: Config): string | null {
  const provider = config.engine.provider
  if (provider.startsWith('custom:')) {
    const entry = config.engine.customEngines.find((e) => e.id === provider.slice('custom:'.length))
    return entry?.endpoint.trim() ? entry.endpoint : null
  }
  switch (provider) {
    case 'openai':
      return config.engine.openai.endpoint || 'https://api.openai.com/v1'
    case 'deepseek':
      return config.engine.deepseek.endpoint || 'https://api.deepseek.com/v1'
    case 'claude':
      return 'https://api.anthropic.com'
    case 'gemini':
      return 'https://generativelanguage.googleapis.com'
    case 'aimao':
      return AIMAO_ENDPOINT
    case 'libretranslate':
      return config.engine.keys.libreUrl || 'https://libretranslate.com'
    case 'custom':
      return config.engine.custom.url
    default:
      return null
  }
}

async function assertEndpointPermission(config: Config): Promise<void> {
  const url = endpointUrlOf(config)
  if (!url) return
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    throw new Error(`接口地址无效：${url}`)
  }
  const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] })
  if (!granted) {
    throw new Error(`缺少对 ${origin} 的访问权限，请在设置页保存引擎配置以授予权限`)
  }
}

/**
 * 路由已预处理文本：BYOK 单发（失败即抛）；免费链冷却降级；
 * supportsBatch 且 batch.enabled 走 BatchQueue（批失败逐条 engine.translate 兜底）。
 * config 为有效配置（AI + 上下文时已是 withPageContext 注入版）；ctxSig 为上下文
 * 签名，混入批队列 key——system prompt 不同的页面不可混入同一批。
 */
async function routePrepared(
  prepared: string,
  from: string,
  to: string,
  config: Config,
  terms: GlossaryTerm[],
  ctxSig?: string,
): Promise<EngineResult> {
  const ctx: EngineContext = { config }
  const engine = resolveEngine(config.engine.provider, ctx)
  if (engine.kind === 'free') {
    return translateFreeChain(prepared, from, to, config, engine)
  }
  await assertEndpointPermission(config)
  if (engine.supportsBatch && config.batch.enabled) {
    // 队列 key 带术语表签名 + 上下文签名：system prompt 内容不同批不可混排
    const queueKey =
      `${engine.id}|${from}|${to}|${textHash(sigOf(terms))}` +
      (ctxSig ? `|${textHash(ctxSig)}` : '')
    const queue = getBatchQueue(
      queueKey,
      (texts) => withTimeout((signal) => engine.translateBatch!(texts, from, to, ctx, signal), config.engine.timeoutMs),
      {
        intervalMs: config.batch.intervalMs,
        maxTexts: config.batch.maxTexts,
        maxChars: config.batch.maxChars,
        concurrency: config.batch.concurrency,
      },
      { fallbackSingles: (t) => engine.translate(t, from, to, ctx).then((r) => r.text) },
    )
    const text = await queue.addTask(prepared)
    return { text }
  }
  return withTimeout((signal) => engine.translate(prepared, from, to, ctx, signal), config.engine.timeoutMs)
}

// ── 对外入口 ────────────────────────────────────────────────────────────────

/**
 * 单条翻译（消息 kind:'translate' 的管线实现，契约 §7）。
 * cache 命中直接返回，不请求引擎。
 */
export async function translate(
  text: string,
  opts: TranslateOptions,
  config: Config,
): Promise<EngineResult> {
  const from = opts.sourceLang ?? config.general.sourceLang ?? 'auto'
  const to = opts.targetLang
  const terms = await resolveEffectiveGlossary(config)
  const context = effectiveContext(opts, config.engine.provider)
  const key = keyFor(config.engine.provider, from, to, text, terms, context)
  const cached = await cacheGet(key)
  if (cached !== undefined) return { text: cached }

  const prep = prepare(text, config, terms)
  const effConfig = context ? withPageContext(config, context) : config
  const routed = await routePrepared(prep.text, from, to, effConfig, terms, context)
  const restored = restorePrepared(prep, routed.text)
  await cacheSet(key, restored)
  return { text: restored, detectedLang: routed.detectedLang }
}

/** 批量入口（消息 kind:'translateBatch'）：逐条 cache 查/预处理，能聚合则一批送 translateBatch 再逐条逆序还原，否则逐条走 translate 管线。 */
export async function translateTexts(
  texts: string[],
  opts: TranslateOptions,
  config: Config,
): Promise<string[]> {
  const from = opts.sourceLang ?? config.general.sourceLang ?? 'auto'
  const to = opts.targetLang
  const terms = await resolveEffectiveGlossary(config)
  const context = effectiveContext(opts, config.engine.provider)
  const effConfig = context ? withPageContext(config, context) : config
  const engine = resolveEngine(config.engine.provider, { config: effConfig })
  const results: string[] = new Array<string>(texts.length)
  const preps: Array<Prepared | undefined> = new Array<Prepared | undefined>(texts.length)
  const pendingIdx: number[] = []

  for (let i = 0; i < texts.length; i++) {
    const key = keyFor(config.engine.provider, from, to, texts[i], terms, context)
    const cached = await cacheGet(key)
    if (cached !== undefined) {
      results[i] = cached
      continue
    }
    preps[i] = prepare(texts[i], config, terms)
    pendingIdx.push(i)
  }
  if (pendingIdx.length === 0) return results

  const writeBack = async (i: number, restored: string): Promise<void> => {
    results[i] = restored
    await cacheSet(keyFor(config.engine.provider, from, to, texts[i], terms, context), restored)
  }

  if (engine.supportsBatch && config.batch.enabled) {
    const preparedTexts = pendingIdx.map((i) => (preps[i] as Prepared).text)
    let outs: string[]
    try {
      outs = await engine.translateBatch!(preparedTexts, from, to, { config: effConfig })
    } catch {
      // 整批失败 → 逐条单发兜底
      outs = await Promise.all(
        preparedTexts.map((t) => engine.translate(t, from, to, { config: effConfig }).then((r) => r.text)),
      )
    }
    for (let k = 0; k < pendingIdx.length; k++) {
      const i = pendingIdx[k]
      const prep = preps[i] as Prepared
      await writeBack(i, restorePrepared(prep, outs[k] ?? prep.text))
    }
    return results
  }

  await Promise.all(
    pendingIdx.map(async (i) => {
      const prep = preps[i] as Prepared
      const routed = await routePrepared(prep.text, from, to, effConfig, terms, context)
      await writeBack(i, restorePrepared(prep, routed.text))
    }),
  )
  return results
}

/**
 * 语种检测：优先 google 引擎 auto 检测取 detectedLang；失败回退 detectPageLang 式
 * 正文推断（对 text 做文字占比统计，ja → zh → ko → ru → ar → 拉丁 顺序）。
 */
export async function detectLang(text: string, config: Config): Promise<string | undefined> {
  try {
    const res = await ENGINES.google.translate(text, 'auto', config.general.targetLang, { config })
    if (res.detectedLang) return res.detectedLang
  } catch {
    // 网络失败 → 本地推断
  }
  const s = scriptStats(text.slice(0, 1000))
  if (s.total < 4) return undefined
  const ratio = (n: number) => n / s.total
  if (s.kana > 0 && (ratio(s.kana) > 0.05 || ratio(s.cjk) > 0.2)) return 'ja'
  if (ratio(s.cjk) > 0.2) return 'zh-CN'
  if (ratio(s.hangul) > 0.2) return 'ko'
  if (ratio(s.cyrillic) > 0.2) return 'ru'
  if (ratio(s.arabic) > 0.2) return 'ar'
  if (ratio(s.latin) > 0.2) return 'en'
  return undefined
}

// ── AI 阅读辅助（FluentRead 四动作）──────────────────────────────────────────

export type AiAssistAction = 'meaning' | 'grammar' | 'usage' | 'practice'

const AI_ASSIST_PROMPTS: Record<AiAssistAction, (target: string) => string> = {
  meaning: (t) =>
    `You are a bilingual dictionary assistant. The user provides a single word or short phrase. ` +
    `Respond in ${t} with exactly three sections:\n` +
    `1. 释义：简明释义（${t}）\n` +
    `2. 词性：词性标注（如 n. / v. / adj. / adv. / phr.）\n` +
    `3. 例句：两条双语例句（原文 + ${t} 译文）`,
  grammar: (t) =>
    `You are a grammar analyzer. Analyze the user's sentence and respond in ${t}. ` +
    `Start with a Markdown table with exactly these four columns: Text | POS | Role | Meaning — ` +
    `one row per word or phrase (Text=原文片段, POS=词性, Role=句法成分如主语/谓语/宾语/状语, Meaning=${t} 释义), ` +
    `then a one-line summary of the overall sentence pattern.`,
  usage: (t) =>
    `You are a usage guide. For the user's word or phrase, respond in ${t} covering: ` +
    `常见搭配（collocations）、语法模式（介词/从句/时态要求）、语域与使用注意；每点配一个简短例句。`,
  practice: (t) =>
    `You are a language exercise generator. Based on the user's text, create exactly 3 practice exercises ` +
    `(fill-in-the-blank / translation / error-correction, whichever fits). Respond in ${t}. ` +
    `Number them 1-3 and append an answer key at the end.`,
}

const AI_PROVIDER_ERROR = '请先在设置页配置 AI 引擎'

/**
 * AI 兼容端点解析（aiAssist / aiChat / aiWrite 共用，导出供 aiWrite 与单测）：
 * - openai/deepseek：各自 config 段的 endpoint/model，key 共用 keys.openai
 * - aimao：固定端点 AIMAO_ENDPOINT，key 走 keys.aimao，model 走 engine.aimao.model
 * - custom:<id>：endpoint/model/apiKey 均取 config.engine.customEngines 里的 entry
 * 非 AI provider、缺 key、或 custom 条目缺失时抛配置引导错误。
 * claude/gemini 为原生协议引擎，阅读辅助/写作的 OpenAI 兼容通道暂不支持（同旧行为抛引导错误）。
 */
export function resolveAiEndpoint(config: Config): { base: string; model: string; apiKey: string } {
  const provider = config.engine.provider
  if (!isAiProvider(provider)) throw new Error(AI_PROVIDER_ERROR)
  if (provider === 'openai' || provider === 'deepseek') {
    if (!config.engine.keys.openai.trim()) throw new Error(AI_PROVIDER_ERROR)
    const ep = provider === 'deepseek' ? config.engine.deepseek : config.engine.openai
    const fallback =
      provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'
    return {
      base: (ep.endpoint || fallback).replace(/\/+$/, ''),
      model: ep.model,
      apiKey: config.engine.keys.openai,
    }
  }
  if (provider === 'aimao') {
    if (!config.engine.keys.aimao.trim()) throw new Error(AI_PROVIDER_ERROR)
    return {
      base: AIMAO_ENDPOINT,
      model: config.engine.aimao.model,
      apiKey: config.engine.keys.aimao,
    }
  }
  if (provider.startsWith('custom:')) {
    const entry = config.engine.customEngines.find((e) => e.id === provider.slice('custom:'.length))
    if (!entry || !entry.endpoint.trim() || !entry.apiKey.trim()) throw new Error(AI_PROVIDER_ERROR)
    return {
      base: entry.endpoint.replace(/\/+$/, ''),
      model: entry.model,
      apiKey: entry.apiKey,
    }
  }
  // claude / gemini：原生协议，无 OpenAI 兼容端点可解析
  throw new Error(AI_PROVIDER_ERROR)
}

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 非流式 chat/completions 请求（aiAssist / aiChat 共用）。 */
async function postChatCompletion(
  config: Config,
  messages: ChatCompletionMessage[],
  temperature: number,
  logPrefix: string,
): Promise<string> {
  const { base, model, apiKey } = resolveAiEndpoint(config)
  const res = await getFetch()(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, temperature, stream: false, messages }),
  })
  if (!res.ok) throw new Error(`${logPrefix}: HTTP ${res.status}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`${logPrefix}: ${data.error.message}`)
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error(`${logPrefix}: unexpected response shape`)
  return content.trim()
}

/**
 * 组装 aiAssist 的 user 消息（导出供单测验证 prompt 要素）。
 * 有上下文时前置 `<context>` 块并声明"仅供理解，不要翻译"，防模型把上下文当待译文本。
 */
export function buildAssistUserMessage(text: string, context?: string): string {
  const ctx = context?.trim()
  if (!ctx) return text
  return (
    'The following context comes from the page around the selected text. ' +
    'It is provided for comprehension only — do not translate it (以下上下文仅供理解，不要翻译):\n' +
    `<context>\n${ctx}\n</context>\n\n${text}`
  )
}

/**
 * AI 阅读辅助：用当前 AI provider 的 OpenAI 兼容配置（见 resolveAiEndpoint）
 * 发一次非流式 chat/completions 请求。provider 非 AI 引擎（isAiProvider=false）
 * 或未配置 key 时抛配置引导错误。context 为选中内容所在段落上下文（可选）。
 */
export async function aiAssist(
  action: AiAssistAction,
  text: string,
  targetLang: string,
  config: Config,
  context?: string,
): Promise<string> {
  const system = AI_ASSIST_PROMPTS[action](langName(targetLang, 'en'))
  return postChatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: buildAssistUserMessage(text, context) },
    ],
    0.1,
    'aiAssist',
  )
}

/** 多轮追问的 system prompt：延续首轮解析的语境与语言。 */
const AI_CHAT_SYSTEM =
  'You are a reading assistant inside a translation browser extension. ' +
  'The user is studying a selected word, phrase or sentence from a web page; the first user message ' +
  'carries the selection, its page context and the initial analysis request. ' +
  'Answer follow-up questions about meaning, grammar, usage or practice concisely and accurately, ' +
  'in the language requested by the conversation.'

/**
 * AI 阅读卡片多轮追问（重灾区 #5）：messages 为 content 侧维护的完整对话历史
 * （首条 user = 选中内容+上下文+初始问题，assistant = 首轮回答，之后交替），
 * 前置阅读助手 system prompt 后整体发送，非流式返回本轮回答。
 */
export async function aiChat(messages: AiChatMessage[], config: Config): Promise<string> {
  if (messages.length === 0) throw new Error('aiChat: empty messages')
  return postChatCompletion(
    config,
    [{ role: 'system', content: AI_CHAT_SYSTEM }, ...messages],
    0.3,
    'aiChat',
  )
}
