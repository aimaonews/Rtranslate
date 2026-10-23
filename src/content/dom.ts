// DOM 候选发现与文本抽取（占位符序列化）。
// 设计参考 KISS Translator 的占位符协议与 MTranBrowser 的两级候选策略：
// 语义块优先，覆盖不足时用"纯文本叶子块"兜底；反向文档序取最小翻译单元防嵌套双翻。
import { isIdentifierLike, isMeaningfulText, normalizeText } from '../core/text'
import { looksLikeLang } from '../core/detect'

/** 整棵子树跳过的选择器 */
const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'textarea', 'select', 'canvas',
  'svg', 'math', 'video', 'audio', 'object', 'embed', 'map', 'datalist', 'dialog',
  'pre', 'code', 'kbd', 'samp', 'var', // 代码类作为容器整体不翻；作为内联由占位符保留
  '[contenteditable="true"]', '[translate="no"]', '.notranslate', '.sr-only',
  '[data-tv-owned]', '[data-tv-translated]', 'tv-translation',
].join(',')

/** 语义翻译单元 */
const SEMANTIC_SELECTOR = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dd', 'dt', 'td', 'th',
  'blockquote', 'figcaption', 'summary', 'caption',
].join(',')

/** 叶子兜底容器 */
const LEAF_SELECTOR = 'div, section, article, aside, main, header, footer, span, label, button'

/** 递归抽取时停止下钻的块级子元素（其文本属于独立单元） */
const BLOCK_CHILD_TAGS = new Set([
  'P', 'DIV', 'UL', 'OL', 'DL', 'TABLE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'ASIDE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'FIGURE', 'FORM', 'FIELDSET', 'DETAILS',
])

/** 序列化为占位符的内联标签（译文里还原为 <code>） */
const CODE_TAGS = new Set(['CODE', 'KBD', 'TT', 'SAMP', 'VAR'])

/**
 * 行内富文本标签：序列化为配对占位符 <aN>内容</aN>，译后还原为真实标签。
 * 占位符格式选型（参考 KISS Translator 的 WARP 协议）：多数翻译引擎（谷歌/微软/LLM）
 * 对"类 HTML 标签"会原样穿透而不翻译其内容，因此用 <a1> 这种合法标签形态存活率最高；
 * 纯文本占位（如 [t1]）容易被引擎拆散或翻译，故不采用。
 */
const INLINE_TAGS = new Set([
  'A', 'B', 'I', 'EM', 'STRONG', 'SPAN', 'MARK', 'Q', 'CITE', 'U', 'S',
  'SUB', 'SUP', 'SMALL', 'ABBR', 'TIME', 'DFN', 'INS', 'DEL',
])

/** 行内标签占位信息：A 存 href（还原时重建安全属性），其他标签存 outerHTML 的开/闭包装 */
export interface InlineTagInfo {
  /** 原始标签名（小写），如 'a' / 'strong' */
  tag: string
  /** 仅 A：原始 href，还原时经协议白名单校验后重建 */
  href?: string
  /** 非 A：序列化时保存的原始开始标签（含属性，属性值已转义） */
  openTag?: string
  /** 非 A：原始结束标签 */
  closeTag?: string
}

/** 占位符值：string 为 {{n}} 整块替换 HTML（code 类）；InlineTagInfo 为 <aN> 行内配对 */
export type PlaceholderValue = string | InlineTagInfo

export interface ExtractedText {
  text: string
  /** 'n' -> {{n}} 整块 HTML（已转义）；'aN' -> 行内标签配对信息 */
  placeholders: Map<string, PlaceholderValue>
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isVisible(el: Element): boolean {
  const st = getComputedStyle(el)
  return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0'
}

/** 向上检查是否处于导航/页头页脚/扩展 UI 中（遇到 article/main 停止，其内部 header 视为正文） */
function inChromelessRegion(el: Element): boolean {
  let cur: Element | null = el.parentElement
  while (cur && cur !== document.body) {
    const tag = cur.tagName
    const role = cur.getAttribute('role')
    if (tag === 'ARTICLE' || tag === 'MAIN' || role === 'main') return false
    if (tag === 'NAV' || role === 'navigation' || role === 'toolbar' || role === 'menubar' || role === 'tablist')
      return true
    if ((tag === 'HEADER' || tag === 'FOOTER' || role === 'banner' || role === 'contentinfo') &&
        !cur.closest('article, main, [role="main"]')) return true
    if (cur.hasAttribute('data-tv-owned')) return true
    cur = cur.parentElement
  }
  return false
}

/** 序列化行内元素为占位信息：A 存 href；其他存 outerHTML 的开/闭标签包装 */
function serializeInlineTag(el: Element): InlineTagInfo {
  const tag = el.tagName.toLowerCase()
  if (el.tagName === 'A') {
    return { tag, href: el.getAttribute('href') ?? undefined }
  }
  let openTag = `<${tag}`
  for (const attr of Array.from(el.attributes)) {
    openTag += ` ${attr.name}="${escapeHtml(attr.value)}"`
  }
  return { tag, openTag: `${openTag}>`, closeTag: `</${tag}>` }
}

/** 抽取元素文本：行内标签配对占位（<aN>…</aN>），code 类整块占位（{{n}}），BR 换行，块级子元素不下钻 */
export function extractText(el: Element): ExtractedText | null {
  const placeholders = new Map<string, PlaceholderValue>()
  let counter = 0 // {{n}} 整块占位计数（code 类）
  let wrapCounter = 0 // <aN> 行内配对占位计数
  const parts: string[] = []

  const walk = (node: Node, out: string[]) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push((child as Text).data.replace(/\s+/g, ' '))
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const e = child as Element
        // 顺序注意：code 类必须先于 SKIP_SELECTOR 判断——SKIP 里的 code/kbd 等是"容器整体不翻"
        // 语义，而行内 code 要走 {{n}} 整块占位，先判 SKIP 会把行内 code 直接吞掉
        if (CODE_TAGS.has(e.tagName)) {
          const code = normalizeText(e.textContent ?? '')
          if (code) {
            counter += 1
            placeholders.set(String(counter), `<code>${escapeHtml(code)}</code>`)
            out.push(` {{${counter}}} `)
          }
          continue
        }
        if (e.matches(SKIP_SELECTOR)) continue
        if (e.tagName === 'BR') {
          out.push('\n')
          continue
        }
        if (e.tagName === 'IMG') {
          const alt = normalizeText(e.getAttribute('alt') ?? '')
          if (alt.length >= 3 && !isIdentifierLike(alt)) out.push(alt)
          continue
        }
        if (BLOCK_CHILD_TAGS.has(e.tagName)) continue // 独立翻译单元
        if (!isVisible(e)) continue
        if (INLINE_TAGS.has(e.tagName)) {
          // 行内富文本：先占号（外层小编号，符合文档序直觉）再递归抽取内容，
          // 用 <aN>…</aN> 配对包裹，标签信息存 placeholders
          wrapCounter += 1
          const key = `a${wrapCounter}`
          const innerParts: string[] = []
          walk(e, innerParts)
          const content = innerParts.join('')
          if (!content.trim()) {
            // 空内联元素不占位（回退编号）；内容为空说明内部无任何产出，回退安全
            wrapCounter -= 1
            continue
          }
          placeholders.set(key, serializeInlineTag(e))
          out.push(`<${key}>${content}</${key}>`)
          continue
        }
        walk(e, out)
      }
    }
  }
  walk(el, parts)

  // 行级整理：行内折叠空白，保留 \n 分行
  const text = parts
    .join('')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter((line, i, arr) => !(line === '' && (arr[i - 1] === undefined || arr[i - 1] === '')))
    .join('\n')
    .trim()

  if (!text) return null
  return { text, placeholders }
}

export interface Unit extends ExtractedText {
  element: Element
}

/** 元素是否为合法翻译单元 */
export function isValidUnit(el: Element, targetLang: string): 'ok' | 'skip' | 'done' {
  if (!(el instanceof HTMLElement) || !el.isConnected) return 'skip'
  if (el.closest('[data-tv-owned]')) return 'skip'
  if (el.hasAttribute('data-tv-translated')) return 'done'
  if (el.matches(SKIP_SELECTOR)) return 'skip'
  if (inChromelessRegion(el)) return 'skip'
  if (!isVisible(el)) return 'skip'
  const extracted = extractText(el)
  if (!extracted) return 'skip'
  // 占位标签（<aN>/{{n}}）不参与"是否有意义/是否已是目标语言"的判断
  const text = extracted.text.replace(/<\/?a\d+>/gi, ' ')
  if (!isMeaningfulText(text.replace(/\n/g, ' '), 2)) return 'skip'
  if (isIdentifierLike(text.replace(/\n/g, ' '))) return 'skip'
  if (looksLikeLang(text, targetLang)) return 'done' // 已是目标语言：标记完成不再处理
  return 'ok'
}

function coversEnough(accepted: Element[]): boolean {
  const body = document.body
  if (!body) return false
  const total = (body.textContent ?? '').trim().length
  if (total < 200) return true
  let sum = 0
  for (const el of accepted) sum += (el.textContent ?? '').trim().length
  return sum / total >= 0.5
}

/**
 * 收集翻译候选。语义块优先；覆盖 <50% 时加叶子兜底。
 * 反向文档序取最小单元（内层被接受后外层弃选），返回文档序。
 */
export function findCandidates(root: ParentNode, targetLang: string): Element[] {
  const semantic = new Set<Element>(
    Array.from(root.querySelectorAll(SEMANTIC_SELECTOR)),
  )
  if (root instanceof Element && root.matches(SEMANTIC_SELECTOR)) semantic.add(root)

  const all: Element[] = []
  const accepted: Element[] = []
  for (const el of semantic) {
    const v = isValidUnit(el, targetLang)
    if (v === 'ok') {
      accepted.push(el)
      all.push(el)
    } else if (v === 'done') {
      el.setAttribute('data-tv-translated', 'skipped')
    }
  }

  if (!coversEnough(accepted)) {
    const leafs = root.querySelectorAll(LEAF_SELECTOR)
    const leafAccepted: Element[] = []
    for (const el of Array.from(leafs)) {
      if (accepted.includes(el) || semantic.has(el)) continue
      if (!el.childNodes.length) continue
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n as Text).data.trim().length >= 12,
      )
      if (!hasDirectText) continue
      if (isValidUnit(el, targetLang) === 'ok') leafAccepted.push(el)
    }
    for (const el of leafAccepted) {
      if (accepted.some((a) => a.contains(el))) continue
      accepted.push(el)
      all.push(el)
    }
  }

  // 最小单元：若已有接受单元包含本元素，弃选本元素（保留内层）
  const minimal = all.filter((el) => !accepted.some((a) => a !== el && a.contains(el)))
  minimal.sort((a, b) => {
    const pos = a.compareDocumentPosition(b)
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
  return minimal
}

/** href 协议白名单：http/https/mailto；无协议的相对地址（/path、#anchor、//host）视为安全 */
function sanitizeHref(raw: string | null): string | null {
  if (!raw) return null
  // 浏览器解析 URL 前会剔除 \t\n\r，先做同样剔除，防 "java\tscript:" 混淆绕过
  const cleaned = raw.replace(/[\t\n\r]/g, '').trim()
  if (!cleaned) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (scheme) {
    const s = scheme[1].toLowerCase()
    if (s !== 'http' && s !== 'https' && s !== 'mailto') return null
  }
  return cleaned
}

/** 还原时重建行内开始标签：A 用校验过的 href + 安全属性；其他用序列化时存的原始开标签 */
function inlineOpenHtml(info: InlineTagInfo): string {
  if (info.tag === 'a') {
    const href = sanitizeHref(info.href ?? null)
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">` : '<a>'
  }
  return info.openTag ?? `<${info.tag}>`
}

function inlineCloseHtml(info: InlineTagInfo): string {
  return info.closeTag ?? `</${info.tag}>`
}

/** 匹配转义后的行内占位标签：&lt;a1&gt; / &lt;/a1&gt;，容忍大小写与内部空白、自闭合 */
const INLINE_TOKEN_RE = /&lt;\s*(\/?)\s*a\s*(\d+)\s*(\/?)\s*&gt;/gi

/**
 * 把转义后译文里的 <aN>…</aN> 配对占位还原为真实 HTML。
 * 容错策略（引擎可能乱序/改大小写/丢闭合）：
 * - 按 id 各自维护开启栈，第 k 个闭合配对最近的未配对开启；
 * - 未配对的开启/闭合一律丢弃该包装、只保留内部文本（绝不输出悬空标签）；
 * - 交叉配对（<a1><a2></a1></a2>）交给后续 DOMParser 的 HTML5 容错解析修正嵌套。
 */
function restoreInlineTags(html: string, placeholders: Map<string, PlaceholderValue>): string {
  interface Tok { start: number; end: number; id: string; close: boolean; selfClose: boolean }
  const toks: Tok[] = []
  for (const m of html.matchAll(INLINE_TOKEN_RE)) {
    toks.push({
      start: m.index,
      end: m.index + m[0].length,
      id: `a${m[2]}`,
      close: m[1] === '/',
      selfClose: m[3] === '/',
    })
  }
  if (!toks.length) return html

  const openStacks = new Map<string, number[]>()
  const pairedOpen = new Set<number>()
  const pairedClose = new Set<number>()
  toks.forEach((t, i) => {
    if (t.selfClose) return // 自闭合占位无法承载内容，直接丢弃
    if (!t.close) {
      const st = openStacks.get(t.id) ?? []
      st.push(i)
      openStacks.set(t.id, st)
    } else {
      const st = openStacks.get(t.id)
      if (st && st.length) {
        pairedOpen.add(st.pop()!)
        pairedClose.add(i)
      }
    }
  })

  let out = ''
  let pos = 0
  toks.forEach((t, i) => {
    out += html.slice(pos, t.start)
    pos = t.end
    const info = placeholders.get(t.id)
    if (typeof info !== 'object') return // 编号未知（或撞上 {{n}} 整块占位）：丢弃
    if (pairedOpen.has(i)) out += inlineOpenHtml(info)
    else if (pairedClose.has(i)) out += inlineCloseHtml(info)
    // 未配对：丢弃占位符本身，文本保留
  })
  out += html.slice(pos)
  return out
}

/** 译文允许存活的行内标签白名单（与 INLINE_TAGS 对应 + code/br） */
const RICH_ALLOWED_TAGS = new Set([
  'A', 'B', 'I', 'EM', 'STRONG', 'SPAN', 'MARK', 'Q', 'CITE', 'U', 'S',
  'SUB', 'SUP', 'SMALL', 'ABBR', 'TIME', 'DFN', 'INS', 'DEL', 'CODE', 'BR',
])

/** 连内容一起丢弃的标签（脚本/样式/嵌入物） */
const RICH_DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT'])

/** 白名单迁移：只保留允许的标签；A 仅保留校验过的 href + target/rel，其他标签剥离全部属性 */
function migrateRichChildren(src: Node, dst: Node) {
  for (const node of Array.from(src.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      dst.appendChild(document.createTextNode((node as Text).data))
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (RICH_DROP_TAGS.has(el.tagName)) continue
      if (!RICH_ALLOWED_TAGS.has(el.tagName)) {
        migrateRichChildren(el, dst) // 非白名单：剥壳但保留内部文本
        continue
      }
      let clean: HTMLElement
      if (el.tagName === 'A') {
        clean = document.createElement('a')
        const href = sanitizeHref(el.getAttribute('href'))
        if (href) {
          clean.setAttribute('href', href)
          clean.setAttribute('target', '_blank')
          clean.setAttribute('rel', 'noopener')
        }
      } else {
        clean = document.createElement(el.tagName.toLowerCase())
      }
      migrateRichChildren(el, clean)
      dst.appendChild(clean)
    }
  }
}

/** DOMParser 解析 + 白名单迁移；解析失败时降级返回字符串（其本身已整体转义，受控标签安全） */
function sanitizeRichHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const out = document.createElement('div')
    migrateRichChildren(doc.body, out)
    return out.innerHTML
  } catch {
    return html
  }
}

/**
 * 把译文文本 + 占位符还原为可注入 HTML。
 * 管线：引擎二次转义归一（&lt;aN&gt; → 裸标签，仅当编号真实存在，防误吃原文字面实体）
 * → 整体转义（中和引擎返回的任何真实 HTML）→ {{n}} 整块还原 → <aN> 配对还原 → \n 换行
 * → DOMParser 白名单迁移（最终安全闸）。
 */
export function buildTranslationHtml(text: string, placeholders: Map<string, PlaceholderValue>): string {
  let src = text.replace(INLINE_TOKEN_RE, (m, slash: string, digits: string, selfClose: string) =>
    placeholders.has(`a${digits}`) ? `<${slash}a${digits}${selfClose}>` : m,
  )
  let html = escapeHtml(src)
  html = html.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
    const v = placeholders.get(n)
    return typeof v === 'string' ? v : ''
  })
  html = restoreInlineTags(html, placeholders)
  html = html.replace(/\n/g, '<br>')
  return sanitizeRichHtml(html)
}
