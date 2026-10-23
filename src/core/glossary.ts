/**
 * Rtranslate core — 术语表占位符注入/还原 + LLM glossary prompt 块。
 *
 * 翻译前把原文中的术语替换成 __GLOSSARY_N__ 占位符（LLM 被告知按术语表保持一致），
 * 译文返回后把占位符还原为目标术语（dst）。占位符文本即 key，还原不依赖位置映射。
 *
 * 匹配规则：
 * - src 长度降序（先长后短），重叠时长术语抢占区间，短术语只补长术语没覆盖的；
 * - 边界感知：术语两端紧邻字母/数字时不匹配（"cat" 不命中 "category"、"concatenate"）；
 * - 大小写不敏感（"Server" 命中 "server"）；
 * - 替换从后往前进行，避免前置替换导致后续偏移失效。
 *
 * 本模块为 core 纯逻辑：零浏览器 API、零外部依赖。
 */

export interface GlossaryTerm {
  src: string
  dst: string
}

export interface GlossaryEntity {
  /** 按原文出现顺序从 1 递增 */
  serial: number
  /** 目标术语（dst），还原时写回译文 */
  value: string
}

export interface ApplyGlossaryResult {
  text: string
  entities: GlossaryEntity[]
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 边界感知：术语两端是字母（任意文字系统）或数字时不匹配
const BOUNDARY_LOOKBEHIND = String.raw`(?<![\p{L}\p{N}])`
const BOUNDARY_LOOKAHEAD = String.raw`(?![\p{L}\p{N}])`

function placeholderFor(serial: number): string {
  return `__GLOSSARY_${serial}__`
}

interface Span {
  start: number
  end: number
  dst: string
}

/**
 * 注入术语占位符。返回 { text, entities }；entities 为空数组表示没有命中，调用方可跳过 restore。
 * 术语按 src 长度降序扫描，同一区间只归最长的术语（先到先得）；序号按原文出现顺序分配。
 */
export function applyGlossary(text: string, terms: GlossaryTerm[]): ApplyGlossaryResult {
  // 去重 + 去空 src（大小写不敏感）；长度降序保证重叠时长术语优先
  const seen = new Set<string>()
  const sorted: GlossaryTerm[] = []
  for (const t of terms) {
    const src = t.src
    if (!src) continue
    const key = src.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sorted.push({ src, dst: t.dst })
  }
  sorted.sort((a, b) => b.src.length - a.src.length)
  if (!text || sorted.length === 0) return { text, entities: [] }

  const spans: Span[] = []
  const overlaps = (s: number, e: number): boolean => spans.some((x) => s < x.end && e > x.start)

  for (const t of sorted) {
    // 边界感知 + 大小写不敏感；模块内新建正则，不共享 lastIndex
    const re = new RegExp(
      BOUNDARY_LOOKBEHIND + escapeRegExp(t.src) + BOUNDARY_LOOKAHEAD,
      'giu',
    )
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++ // 防御零宽匹配死循环
        continue
      }
      const start = m.index
      const end = start + m[0].length
      if (overlaps(start, end)) continue
      spans.push({ start, end, dst: t.dst })
    }
  }
  if (spans.length === 0) return { text, entities: [] }

  // 序号按出现顺序分配；替换从后往前，避免偏移失效
  spans.sort((a, b) => a.start - b.start)
  const entities: GlossaryEntity[] = spans.map((s, i) => ({ serial: i + 1, value: s.dst }))

  let out = text
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i]
    out = out.slice(0, s.start) + placeholderFor(i + 1) + out.slice(s.end)
  }
  return { text: out, entities }
}

/**
 * 还原。占位符文本即 key（不依赖位置映射）。容忍引擎对占位符的常见改写：
 * 大小写变化、下划线旁插空格、尾部下划线丢失。
 * 找不到的占位符跳过（该实体在译文中缺失，只影响完整性不泄露信息）。
 */
export function restoreGlossary(text: string, entities: GlossaryEntity[]): string {
  if (!text || entities.length === 0) return text
  let out = text
  // 序号降序还原，配合 (?!\d) 避免 _1 误吞 _11
  const ordered = [...entities].sort((a, b) => b.serial - a.serial)
  for (const e of ordered) {
    const re = new RegExp(
      '(?:_\\s*){1,4}GLOSSARY[_\\s]+' + e.serial + '(?!\\d)(?:\\s*_{1}){0,4}',
      'gi',
    )
    // 函数回调：value 原样返回，防止其中 `$&` 等被当作替换串特殊序列解释
    out = out.replace(re, () => e.value)
  }
  return out
}

/**
 * 生成注入 system prompt 的 glossary 块；terms 为空时返回空串，调用方自行跳过。
 * 每行 `- src → dst`。
 */
export function glossaryPromptBlock(terms: GlossaryTerm[]): string {
  if (terms.length === 0) return ''
  return terms.map((t) => `- ${t.src} → ${t.dst}`).join('\n')
}

/** 术语表签名（src=dst; 拼接），供缓存 key 在术语表变更时自动失效。空表返回空串。 */
export function glossarySignature(terms: GlossaryTerm[]): string {
  return terms.map((t) => `${t.src}=${t.dst};`).join('')
}
