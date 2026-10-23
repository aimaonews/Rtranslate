/**
 * PPTX 解析器（JSZip + 正则处理 ppt/slides/slideN.xml，与 docx.ts 同套路）。
 * - 按幻灯片数字序（slide2 在 slide10 前）逐页处理；
 * - 片段 = 每个 <a:p> 段落聚合段内全部 <a:t> 文本（<a:br/> → \n）；
 * - build 仅译文：段内第一个 <a:t> 替换为译文、清空其余 <a:t>、删掉多余 <a:br/>；
 *   译文中的 \n 通过"闭合当前 run → <a:br/> → 新开 run"展开（<a:br/> 是段落级元素，
 *   不能放在 <a:r> 内部，与 DOCX 的 <w:br/> 不同）；
 * - build 双语：原 <a:p> 之后插入译文段落副本（复制原 <a:pPr> 段落属性与首个 run 的 <a:rPr>）；
 * - 全程 XML 转义/反转义；ZIP 条目数与解压总量上限（防 zip bomb，同 epub.ts）；
 *   重打包保持其余条目原样。
 */
import { JSZip, type JSZipInstance } from './jszip'
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

const MAX_ENTRIES = 10000
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024 // 200MB

/** 幻灯片路径：ppt/slides/slideN.xml（\b 防止误配 slideLayouts 等目录由前缀保证） */
const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/
/** 段落匹配：自闭合 <a:p/> 或完整 <a:p>...</a:p>；<a:p\b 不会误中 <a:pPr（p 与 P 之间无词边界） */
const PARA_RE = /<a:p\b[^>]*\/>|<a:p\b[^>]*>[\s\S]*?<\/a:p>/g
/** 段内文本 token：<a:t> 文本或 <a:br/> 换行 */
const TOKEN_RE = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g
/** 段落属性 <a:pPr>（自闭合或成对） */
const PPR_RE = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/
/** 首个 run 属性 <a:rPr> */
const RPR_RE = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 提取段落纯文本：<a:t> 聚合，<a:br/> → \n */
function paragraphText(paraXml: string): string {
  let out = ''
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(paraXml)) !== null) {
    if (m[1] !== undefined) out += xmlUnescape(m[1])
    else out += '\n' // <a:br/>
  }
  return out
}

/**
 * 译文文本 → <a:t> 内部内容。\n 展开为"闭合当前 run + <a:br/> + 新开 run"，
 * 调用处保证外层正好处于某个 <a:r>…<a:t> 内（首尾标签由既有结构闭合）。
 */
function textToRunContent(text: string): string {
  return text.split('\n').map(xmlEscape).join('</a:t></a:r><a:br/><a:r><a:t>')
}

/** 为多行译文生成段落级 run 序列（行间插段落级 <a:br/>） */
function runsForText(text: string, rPr: string): string {
  return text
    .split('\n')
    .map((line) => `<a:r>${rPr}<a:t>${xmlEscape(line)}</a:t></a:r>`)
    .join('<a:br/>')
}

interface PptxParagraph {
  /** 段落在其 slide XML 中的起止下标 */
  start: number
  end: number
  xml: string
  segId: number
}

interface PptxSlide {
  /** zip 内路径 */
  path: string
  xml: string
  paragraphs: PptxParagraph[]
}

interface PptxState {
  zip: JSZipInstance
  slides: PptxSlide[]
}

async function parsePptx(buf: ArrayBuffer, name: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) throw new Error('PPTX 条目过多，拒绝处理')
  let total = 0
  for (const e of entries) {
    total += (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error('PPTX 解压总大小超过 200MB，拒绝处理')
  }

  // 收集幻灯片并按数字序排列（slide2 < slide10，而非字典序）
  const slidePaths: { path: string; num: number }[] = []
  for (const path of Object.keys(zip.files)) {
    const m = SLIDE_RE.exec(path)
    if (m) slidePaths.push({ path, num: parseInt(m[1], 10) })
  }
  slidePaths.sort((a, b) => a.num - b.num)
  if (slidePaths.length === 0) throw new Error('不是合法的 PPTX：缺少 ppt/slides/slide*.xml')

  const slides: PptxSlide[] = []
  const segments: { id: number; text: string }[] = []
  for (const { path } of slidePaths) {
    const xml = await zip.file(path)!.async('string')
    const paragraphs: PptxParagraph[] = []
    PARA_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PARA_RE.exec(xml)) !== null) {
      const paraXml = m[0]
      if (paraXml.endsWith('/>')) continue // 空段落
      const text = paragraphText(paraXml)
      if (!isMeaningfulText(text)) continue
      const segId = segments.length
      segments.push({ id: segId, text })
      paragraphs.push({ start: m.index, end: m.index + paraXml.length, xml: paraXml, segId })
    }
    slides.push({ path, xml, paragraphs })
  }
  if (segments.length === 0) throw new Error('PPTX 中没有可翻译的文本')

  const state: PptxState = { zip, slides }
  return { kind: 'pptx', baseName: baseNameOf(name), segments, state }
}

/** 仅译文：替换段内文本为译文（第一个 <a:t> 写译文，其余清空，删掉原有 <a:br/>） */
function replaceParagraphText(paraXml: string, translation: string): string {
  // 顺序关键：先删原有 <a:br/>，再替换 <a:t>——译文的 \n 会展开为新的
  // "闭合 run + <a:br/> + 新开 run"，若先插后删会被误伤。
  let out = paraXml.replace(/<a:br\s*\/>/g, '')
  let firstT = true
  out = out.replace(/<a:t\b([^>]*)>([\s\S]*?)<\/a:t>/g, (_whole, attrs: string) => {
    if (firstT) {
      firstT = false
      return `<a:t${attrs}>${textToRunContent(translation)}</a:t>`
    }
    return `<a:t${attrs}></a:t>`
  })
  return out
}

/** 双语：生成插在原文段之后的译文段落（复制原 pPr 与首个 run 的 rPr 保持样式） */
function translatedParagraph(paraXml: string, translation: string): string {
  const pPr = PPR_RE.exec(paraXml)?.[0] ?? ''
  const rPr = RPR_RE.exec(paraXml)?.[0] ?? ''
  return `<a:p>${pPr}${runsForText(translation, rPr)}</a:p>`
}

async function buildPptx(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): Promise<BuiltFile> {
  const { zip, slides } = doc.state as PptxState

  for (const slide of slides) {
    let out = slide.xml
    let touched = false
    // 从后往前替换，下标不失效
    for (let i = slide.paragraphs.length - 1; i >= 0; i--) {
      const p = slide.paragraphs[i]
      const t = translations.get(p.segId)
      if (t === undefined) continue // 失败保留原文
      touched = true
      if (mode === 'translationOnly') {
        out = out.slice(0, p.start) + replaceParagraphText(p.xml, t) + out.slice(p.end)
      } else {
        out = out.slice(0, p.end) + translatedParagraph(p.xml, t) + out.slice(p.end)
      }
    }
    if (touched) zip.file(slide.path, out)
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    compression: 'DEFLATE',
  })
  return { blob, filename: downloadName(doc.baseName, 'pptx') }
}

export const pptxParser: DocParser = {
  exts: ['pptx'],
  parse: parsePptx,
  build: buildPptx,
}
