/**
 * background/glossaryLibs.ts — AI 术语库：内置库加载 + 有效术语合并 + AI 智能提取。
 *
 * - 内置库：public/glossary/ 下打包的 CSV（数据来自 immersive-translate/terms 社区术语表，
 *   见 public/glossary/index.json 的 source 字段），通过 chrome.runtime.getURL + fetch 懒加载，
 *   内存缓存（SW 生命周期内只请求一次）。
 * - resolveEffectiveGlossary：用户术语（config.glossary）+ 启用的内置库 + 启用的自定义库
 *   合并去重（同名 src 用户术语优先），按 src 长度降序（与 core/glossary 的长词优先语义一致）。
 * - extractTermsWithAI：用 openai 兼容配置（openai/deepseek，复用 aiAssist 的 key/endpoint 约定）
 *   从文本提取专业术语/专名，容错解析 JSON 数组；未配置 AI key 抛配置引导错误。
 *
 * 网络访问统一走 engines/fetch 的 getFetch()，测试用 setFetchImpl 注入替身。
 */

import type { Config, GlossaryTerm, CustomGlossaryLibrary } from '../shared/config'
import { langName } from '../core/langs'
import { getFetch } from './engines/fetch'

// ── 内置库索引 ────────────────────────────────────────────────────────────────

export interface BuiltinLibraryMeta {
  id: string
  name: string
  zhName: string
  file: string
}

interface BuiltinIndex {
  source?: string
  libraries: BuiltinLibraryMeta[]
}

let indexCache: BuiltinLibraryMeta[] | null = null
const libCache = new Map<string, GlossaryTerm[]>()

/** 测试用：清空内存缓存（索引 + 库数据）。 */
export function resetGlossaryLibCaches(): void {
  indexCache = null
  libCache.clear()
}

function glossaryUrl(path: string): string {
  // 扩展环境：chrome.runtime.getURL；测试环境 stub chrome 或直接返回路径
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`glossary/${path}`)
  }
  return `glossary/${path}`
}

/** 读取内置库索引（public/glossary/index.json），内存缓存。 */
export async function listBuiltinLibraries(): Promise<BuiltinLibraryMeta[]> {
  if (indexCache) return indexCache
  const res = await getFetch()(glossaryUrl('index.json'))
  if (!res.ok) throw new Error(`glossaryLibs: 加载内置术语库索引失败 HTTP ${res.status}`)
  const data = (await res.json()) as Partial<BuiltinIndex>
  const libs = Array.isArray(data.libraries) ? data.libraries : []
  indexCache = libs.filter(
    (l): l is BuiltinLibraryMeta =>
      !!l && typeof l.id === 'string' && typeof l.file === 'string' && typeof l.zhName === 'string',
  )
  return indexCache
}

// ── CSV 解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析沉浸式翻译术语表 CSV（表头 source,target,tgt_lng）。
 * 标准 CSV 语义：引号包裹的字段可含逗号/换行，"" 转义为字面引号。
 * 只保留 tgt_lng 为 zh-CN 且 source/target 非空的行；无表头时容错按数据行处理。
 */
export function parseGlossaryCsv(csv: string): GlossaryTerm[] {
  const rows = parseCsvRows(csv)
  if (rows.length === 0) return []
  // 跳过表头（首行首列是 source 即视为表头）
  const start = rows[0][0]?.trim().toLowerCase() === 'source' ? 1 : 0
  const terms: GlossaryTerm[] = []
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]
    if (r.length < 3) continue
    const src = r[0].trim()
    const dst = r[1].trim()
    const tgt = r[2].trim()
    if (tgt !== 'zh-CN' || !src || !dst) continue
    terms.push({ src, dst })
  }
  return terms
}

/** 逐字符 CSV 解析：返回字段矩阵，正确处理引号/逗号/换行/"" 转义。 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let hasContent = false // 本行是否有任何字符（防御末尾空行产出 ['']）
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      hasContent = true
    } else if (c === ',') {
      row.push(field)
      field = ''
      hasContent = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (hasContent || row.length > 1) rows.push(row)
      row = []
      hasContent = false
    } else {
      field += c
      hasContent = true
    }
  }
  row.push(field)
  if (hasContent || row.length > 1) rows.push(row)
  return rows
}

// ── 内置库加载 ────────────────────────────────────────────────────────────────

/** 加载指定内置库（按 id），解析 CSV 并内存缓存。未知 id 抛错。 */
export async function loadBuiltinLibrary(id: string): Promise<GlossaryTerm[]> {
  const cached = libCache.get(id)
  if (cached) return cached
  const libs = await listBuiltinLibraries()
  const meta = libs.find((l) => l.id === id)
  if (!meta) throw new Error(`glossaryLibs: 未知内置术语库 "${id}"`)
  const res = await getFetch()(glossaryUrl(meta.file))
  if (!res.ok) throw new Error(`glossaryLibs: 加载术语库 ${id} 失败 HTTP ${res.status}`)
  const terms = parseGlossaryCsv(await res.text())
  libCache.set(id, terms)
  return terms
}

// ── 有效术语合并 ──────────────────────────────────────────────────────────────

/**
 * 合并全部生效术语：用户术语（最高优先）→ 启用的自定义库 → 启用的内置库。
 * 同名 src（大小写不敏感）先声明者优先；结果按 src 长度降序（长词优先匹配）。
 * 内置库加载失败不阻断翻译（跳过该库）。
 */
export async function resolveEffectiveGlossary(config: Config): Promise<GlossaryTerm[]> {
  const groups: GlossaryTerm[][] = []
  groups.push(Array.isArray(config.glossary) ? config.glossary : [])

  const libs = config.glossaryLibs ?? { enabled: {}, custom: [] }
  const enabled = libs.enabled ?? {}
  const custom: CustomGlossaryLibrary[] = Array.isArray(libs.custom) ? libs.custom : []
  for (const lib of custom) {
    // 自定义库默认启用，仅当 enabled[id] 显式为 false 时关闭
    if (!lib || enabled[lib.id] === false) continue
    if (Array.isArray(lib.terms) && lib.terms.length > 0) groups.push(lib.terms)
  }

  const builtinIds = Object.keys(enabled).filter((id) => enabled[id])
  if (builtinIds.length > 0) {
    const loaded = await Promise.all(
      builtinIds.map(async (id) => {
        try {
          return await loadBuiltinLibrary(id)
        } catch {
          return [] // 单库失败跳过，不影响其余
        }
      }),
    )
    for (const terms of loaded) if (terms.length > 0) groups.push(terms)
  }

  const seen = new Set<string>()
  const merged: GlossaryTerm[] = []
  for (const g of groups) {
    for (const t of g) {
      if (!t || typeof t.src !== 'string' || typeof t.dst !== 'string') continue
      const src = t.src.trim()
      if (!src) continue
      const key = src.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ src, dst: t.dst })
    }
  }
  merged.sort((a, b) => b.src.length - a.src.length)
  return merged
}

// ── AI 智能提取 ───────────────────────────────────────────────────────────────

const AI_PROVIDER_ERROR = '请先在设置页配置 AI 引擎'
const MAX_EXTRACT_INPUT = 4000

function extractSystemPrompt(targetLang: string): string {
  return (
    `You are a terminology extraction assistant. Extract up to 20 domain-specific terms, ` +
    `technical terms or proper nouns from the user's text. For each term give the recommended ` +
    `${targetLang} rendering. Skip common everyday words. ` +
    `Output ONLY a JSON array of objects, no markdown fence, no explanation: ` +
    `[{"src":"...","dst":"..."}]`
  )
}

/** 容错解析模型输出：正则抽取首个 JSON 数组，逐项校验 {src,dst} 字符串。 */
export function parseExtractedTerms(content: string): GlossaryTerm[] {
  const m = content.match(/\[[\s\S]*\]/)
  if (!m) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(m[0])
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const terms: GlossaryTerm[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    if (typeof o.src !== 'string' || typeof o.dst !== 'string') continue
    const src = o.src.trim()
    const dst = o.dst.trim()
    if (!src || !dst) continue
    const key = src.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push({ src, dst })
  }
  return terms
}

/**
 * AI 智能提取术语：openai 兼容 chat/completions 单发请求（复用 aiAssist 的
 * provider/endpoint/key 约定）。provider 不是 openai/deepseek 或未配置 key 时抛配置引导错误。
 */
export async function extractTermsWithAI(
  text: string,
  targetLang: string,
  config: Config,
): Promise<GlossaryTerm[]> {
  const provider = config.engine.provider
  if (provider !== 'openai' && provider !== 'deepseek') throw new Error(AI_PROVIDER_ERROR)
  if (!config.engine.keys.openai.trim()) throw new Error(AI_PROVIDER_ERROR)
  const ep = provider === 'deepseek' ? config.engine.deepseek : config.engine.openai
  const fallback =
    provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'
  const base = (ep.endpoint || fallback).replace(/\/+$/, '')
  const res = await getFetch()(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.engine.keys.openai}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ep.model,
      temperature: 0.1,
      stream: false,
      messages: [
        { role: 'system', content: extractSystemPrompt(langName(targetLang, 'en')) },
        { role: 'user', content: text.slice(0, MAX_EXTRACT_INPUT) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`extractTerms: HTTP ${res.status}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`extractTerms: ${data.error.message}`)
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('extractTerms: unexpected response shape')
  return parseExtractedTerms(content)
}
