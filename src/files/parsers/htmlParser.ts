/**
 * HTML 解析器（files 页是扩展页，可直接 DOMParser）。
 * - 复用 src/content/dom.ts 的 SEMANTIC_SELECTOR 思路：p/h1-h6/li/dd/dt/td/th/blockquote/figcaption
 *   等语义块的文本作为片段；取"最内层"匹配元素防嵌套双翻；
 * - script/style/pre/code 等整棵子树跳过；
 * - build：双语 = 元素内追加 <br> + <span style="color:#64748b">译文</span>；
 *   仅译文 = 替换元素文本；serialize 回完整 HTML。
 * 本文件同时导出供 epub.ts 复用的 DOM 提取/回写助手。
 */
import { isMeaningfulText, normalizeText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

/** 语义翻译单元（与 content/dom.ts SEMANTIC_SELECTOR 同源） */
export const SEMANTIC_SELECTOR = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dd', 'dt', 'td', 'th',
  'blockquote', 'figcaption', 'summary', 'caption',
].join(',')

/** 整棵子树跳过 */
const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'textarea', 'select',
  'svg', 'math', 'object', 'embed', 'pre', 'code', 'kbd', 'samp', 'var',
].join(',')

/**
 * 收集文档中"最内层"语义块元素（其内部不再含其他语义块），按文档序。
 * 供 htmlParser 与 epub 章节解析共用。
 */
export function collectSemanticElements(root: Document): Element[] {
  const all = Array.from(root.querySelectorAll(SEMANTIC_SELECTOR))
  return all.filter((el) => {
    if (el.closest(SKIP_SELECTOR)) return false
    // 内部还有语义块 → 让内层独立成片段，外层跳过
    if (el.querySelector(SEMANTIC_SELECTOR)) return false
    return true
  })
}

/**
 * 把译文应用到元素上。
 * bilingual：元素内追加换行 + 灰色 span 译文；translationOnly：替换元素全部文本。
 * xhtml 模式用 createElementNS 保证序列化合法（<br/>）。
 */
export function applyTranslation(
  el: Element,
  translation: string,
  mode: OutputMode,
  xhtml: boolean,
): void {
  if (mode === 'translationOnly') {
    el.textContent = translation
    return
  }
  const doc = el.ownerDocument
  const br = xhtml
    ? doc.createElementNS('http://www.w3.org/1999/xhtml', 'br')
    : doc.createElement('br')
  const span = xhtml
    ? doc.createElementNS('http://www.w3.org/1999/xhtml', 'span')
    : doc.createElement('span')
  span.setAttribute('style', 'color:#64748b')
  span.setAttribute('data-tv-translation', '1')
  span.textContent = translation
  el.appendChild(br)
  el.appendChild(span)
}

interface HtmlState {
  doc: Document
  elements: Element[]
  hasDoctype: boolean
}

function parseHtml(buf: ArrayBuffer, name: string): ParsedDoc {
  const text = new TextDecoder('utf-8').decode(buf)
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const elements = collectSemanticElements(doc)
  const segments: { id: number; text: string }[] = []
  const kept: Element[] = []
  for (const el of elements) {
    const t = normalizeText(el.textContent ?? '')
    if (!isMeaningfulText(t)) continue
    const segId = segments.length
    segments.push({ id: segId, text: t })
    kept.push(el)
  }
  const state: HtmlState = { doc, elements: kept, hasDoctype: /^\s*<!doctype/i.test(text) }
  return { kind: 'html', baseName: baseNameOf(name), segments, state }
}

function buildHtml(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { doc: dom, elements, hasDoctype } = doc.state as HtmlState
  for (let i = 0; i < elements.length; i++) {
    const t = translations.get(i)
    if (t === undefined) continue // 失败保留原文
    applyTranslation(elements[i], t, mode, false)
  }
  const html = (hasDoctype ? '<!DOCTYPE html>\n' : '') + dom.documentElement.outerHTML
  return {
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    filename: downloadName(doc.baseName, 'html'),
  }
}

export const htmlParser: DocParser = {
  exts: ['html', 'htm'],
  parse: (buf, name) => Promise.resolve(parseHtml(buf, name)),
  build: buildHtml,
}
