import type { Config } from '../../shared/config'
import { langName } from '../../core/langs'
import { PII_PROTECT_NOTE } from '../../core/mask'
import { glossaryPromptBlock } from '../../core/glossary'
import { getExpert, renderExpertPrompt } from '../../core/experts'
import type { Engine, EngineContext, EngineResult } from './types'
import { getFetch, httpError } from './fetch'

export interface OpenAICompatOpts {
  id: string
  name: string
  getEndpoint(ctx: EngineContext): string
  getApiKey(ctx: EngineContext): string
  getModel(ctx: EngineContext): string
  /** 额外自定义请求头（如自定义引擎实例的 headersJson）；Authorization/Content-Type 为强制头，不被覆盖。 */
  getHeaders?(ctx: EngineContext): Record<string, string>
}

const DEFAULT_TEMPERATURE = 0.1

/** 批协议指令：必须后置追加在 system 末尾，不被任何专家 prompt 覆盖。 */
const BATCH_PROTOCOL_NOTE =
  'Output a single JSON object of the form {"translations":[{"id":number,"text":"translation"}]} containing all items, ids must match input.'

/** 推理模型的思维链块（<think>/<thinking>，跨行、大小写不敏感），如 DeepSeek-R1。 */
const THINKING_RE = /<(think|thinking)>[\s\S]*?<\/\1>/gi

/**
 * 剥离思维链块，剥离后 trim。
 * 若剥离后为空（响应只有思维链、忘了输出译文），返回原文兜底，绝不丢内容。
 */
export function stripThinking(text: string): string {
  const stripped = text.replace(THINKING_RE, '').trim()
  return stripped === '' ? text : stripped
}

/** 取当前激活专家；config.experts 缺失/脏数据时回退内置「通用」。 */
export function activeExpert(config: Config) {
  const experts = config.experts
  const list = Array.isArray(experts?.list) ? experts.list : []
  return getExpert(list, experts?.activeId ?? 'general')
}

/**
 * system prompt（契约 §7 四要素的专家化版本）：
 * 专家 systemPrompt + 目标语言全名句 + 只输出译文 + PII 保护句（条件性）+ glossary 块。
 * 批协议指令最后追加，保证不被专家 prompt 覆盖。
 * （导出供 claude/gemini 等原生 AI 引擎复用同一套 prompt 构造逻辑。）
 */
export function buildSystemPrompt(to: string, opts: { pii: boolean; config: Config; batch?: boolean }): string {
  const expert = activeExpert(opts.config)
  const parts = [
    `${expert.systemPrompt} Translate the following text to ${langName(to, 'en')}. ` +
      'Output only the translation, no explanations, no quotes.',
  ]
  if (opts.pii) parts.push(PII_PROTECT_NOTE)
  if (opts.config.glossary.length > 0) parts.push(glossaryPromptBlock(opts.config.glossary))
  if (opts.batch) parts.push(BATCH_PROTOCOL_NOTE)
  return parts.join('\n\n')
}

/** 单发 user prompt：按专家模板渲染占位符（{{text}}/{{to}}/{{from}}/{{glossary}}）。 */
export function buildUserPrompt(text: string, from: string, to: string, config: Config): string {
  const expert = activeExpert(config)
  return renderExpertPrompt(expert.userPrompt, {
    text,
    to: langName(to, 'en'),
    from,
    glossary: config.glossary.length > 0 ? glossaryPromptBlock(config.glossary) : undefined,
  })
}

/** 编号 JSON 批协议的 user 内容：{"id":1,"text":"..."} 列表。 */
export function encodeBatchPayload(texts: string[]): string {
  return texts.map((t, i) => JSON.stringify({ id: i + 1, text: t })).join('\n')
}

/**
 * 批响应解析，容错策略（KISS 编号协议）：
 * - LLM 常包 markdown 围栏/前后缀文本 → 抽取首个 '{' 到最后一个 '}' 再 JSON.parse
 * - 乱序：按 id 归位
 * - 缺条：用原文兜底（绝不抛，整批失败才抛）
 * - 逐条 stripThinking：剥离推理模型思维链
 */
export function parseBatchResponse(content: string, originals: string[]): string[] {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  const jsonStr = start >= 0 && end > start ? content.slice(start, end + 1) : content
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    throw new Error(`openai-compat batch: response is not valid JSON: ${(e as Error).message}`)
  }
  const items = (parsed as { translations?: unknown }).translations
  if (!Array.isArray(items)) throw new Error('openai-compat batch: missing "translations" array')
  const out: string[] = originals.slice()
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const { id, text } = item as { id?: unknown; text?: unknown }
    if (typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= originals.length && typeof text === 'string') {
      out[id - 1] = stripThinking(text)
    }
    // 非法/越界条目静默跳过——LLM 幻觉条目不该拖垮整批
  }
  return out
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  error?: { message?: string }
}

export function createOpenAICompatEngine(opts: OpenAICompatOpts): Engine {
  async function callChat(body: unknown, ctx: EngineContext, signal?: AbortSignal): Promise<string> {
    const apiKey = opts.getApiKey(ctx)
    if (!apiKey) {
      throw new Error(
        `${opts.id}: missing API key. Open the Rtranslate options page and fill in the OpenAI-compatible key field.`
      )
    }
    const base = opts.getEndpoint(ctx).replace(/\/+$/, '')
    const res = await getFetch()(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        // 自定义头在前，强制头（Authorization/Content-Type）在后不可被覆盖
        ...opts.getHeaders?.(ctx),
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw httpError(opts.id, res)
    const data = (await res.json()) as ChatCompletionsResponse
    // 部分兼容端点错误时仍回 200 并带 error 字段
    if (data.error?.message) throw new Error(`${opts.id}: ${data.error.message}`)
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error(`${opts.id}: unexpected response shape`)
    return content.trim()
  }

  return {
    id: opts.id,
    name: opts.name,
    kind: 'byok',
    requiresKey: true,
    supportsBatch: true,

    async translate(text, from, to, ctx, signal): Promise<EngineResult> {
      const system = buildSystemPrompt(to, { pii: text.includes('__PII_'), config: ctx.config })
      const content = await callChat(
        {
          model: opts.getModel(ctx),
          temperature: DEFAULT_TEMPERATURE,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: buildUserPrompt(text, from, to, ctx.config) },
          ],
        },
        ctx,
        signal
      )
      return { text: stripThinking(content) }
    },

    async translateBatch(texts, _from, to, ctx, signal) {
      if (texts.length === 0) return []
      const system = buildSystemPrompt(to, {
        pii: texts.some((t) => t.includes('__PII_')),
        config: ctx.config,
        batch: true,
      })
      const content = await callChat(
        {
          model: opts.getModel(ctx),
          temperature: DEFAULT_TEMPERATURE,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: encodeBatchPayload(texts) },
          ],
        },
        ctx,
        signal
      )
      return parseBatchResponse(content, texts)
    },
  }
}

/** OpenAI：endpoint/model 走 config.engine.openai，key 走 keys.openai。 */
export const openaiEngine = createOpenAICompatEngine({
  id: 'openai',
  name: 'OpenAI Compatible',
  getEndpoint: (ctx) => ctx.config.engine.openai.endpoint || 'https://api.openai.com/v1',
  getApiKey: (ctx) => ctx.config.engine.keys.openai,
  getModel: (ctx) => ctx.config.engine.openai.model || 'gpt-4o-mini',
})

/**
 * DeepSeek 同为 OpenAI 兼容协议。契约（§5）：界面只有一个 OpenAI 兼容 key 输入框，
 * DeepSeek key 也存 keys.openai；endpoint/model 走 config.engine.deepseek。
 */
export const deepseekEngine = createOpenAICompatEngine({
  id: 'deepseek',
  name: 'DeepSeek',
  getEndpoint: (ctx) => ctx.config.engine.deepseek.endpoint || 'https://api.deepseek.com/v1',
  getApiKey: (ctx) => ctx.config.engine.keys.openai,
  getModel: (ctx) => ctx.config.engine.deepseek.model || 'deepseek-chat',
})
