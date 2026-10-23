/**
 * DOCX 解析器（JSZip + 正则处理 word/document.xml，参考 FluentRead binary.ts 方案）。
 * - 按 <w:p> 段落聚合片段：段内 <w:t> 文本 + <w:tab/>→\t + <w:br/>/<w:cr/>→\n；
 * - build 仅译文：段落内第一个 <w:t> 替换为译文、清空其余 <w:t>、删掉多余 <w:tab/>/<w:br/>；
 *   译文中的 \n 转为 <w:br/>、\t 转为 <w:tab/>；
 * - build 双语：原 <w:p> 之后复制插入一个灰色（64748B）译文段落，不碰原段落结构；
 * - 全程 XML 转义/反转义；重打包保持其余条目原样。
 */
import { JSZip, type JSZipInstance } from './jszip'
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

const MAX_ENTRIES = 10000
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024

/** 段落匹配：自闭合 <w:p/> 或完整 <w:p>...</w:p> */
const PARA_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
/** 段内文本 token */
const TOKEN_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g

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

/** 提取段落纯文本 */
function paragraphText(paraXml: string): string {
  let out = ''
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(paraXml)) !== null) {
    if (m[1] !== undefined) out += xmlUnescape(m[1])
    else if (m[0].startsWith('<w:tab')) out += '\t'
    else out += '\n' // <w:br/> / <w:cr/>
  }
  return out
}

/** 译文文本 → w:t 内部内容（\n → <w:br/>，\t → <w:tab/>，保持 xml:space） */
function textToRunContent(text: string): string {
  const pieces = text.split('\n').map((line) => xmlEscape(line).replace(/\t/g, '<w:tab/>'))
  return pieces.join('</w:t><w:br/><w:t xml:space="preserve">')
}

interface DocxParagraph {
  /** 段落在 document.xml 中的起止下标 */
  start: number
  end: number
  xml: string
  segId: number
}

interface DocxState {
  zip: JSZipInstance
  xml: string
  paragraphs: DocxParagraph[]
}

async function parseDocx(buf: ArrayBuffer, name: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) throw new Error('DOCX 条目过多，拒绝处理')
  let total = 0
  for (const e of entries) {
    total += (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error('DOCX 解压总大小超过 200MB，拒绝处理')
  }

  const docEntry = zip.file('word/document.xml')
  if (!docEntry) throw new Error('不是合法的 DOCX：缺少 word/document.xml')
  const xml = await docEntry.async('string')

  const paragraphs: DocxParagraph[] = []
  const segments: { id: number; text: string }[] = []
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
  if (segments.length === 0) throw new Error('DOCX 中没有可翻译的文本')

  const state: DocxState = { zip, xml, paragraphs }
  return { kind: 'docx', baseName: baseNameOf(name), segments, state }
}

/** 仅译文：替换段落内文本为译文（保留第一个 run 的结构） */
function replaceParagraphText(paraXml: string, translation: string): string {
  let firstT = true
  // 先处理 <w:t>：第一个写译文，其余清空
  let out = paraXml.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_whole, attrs: string) => {
    if (firstT) {
      firstT = false
      const space = attrs.includes('xml:space') ? attrs : `${attrs} xml:space="preserve"`
      return `<w:t${space}>${textToRunContent(translation)}</w:t>`
    }
    return `<w:t${attrs}></w:t>`
  })
  // 删掉原有的显式换行/制表（译文已自带）
  out = out.replace(/<w:tab\s*\/>/g, '').replace(/<w:br\s*\/>/g, '').replace(/<w:cr\s*\/>/g, '')
  // 若段落原本没有任何 <w:t>（极端情况），在 </w:p> 前补一个 run
  if (!/<w:t\b/.test(out)) {
    out = out.replace(
      /<\/w:p>$/,
      `<w:r><w:t xml:space="preserve">${textToRunContent(translation)}</w:t></w:r></w:p>`,
    )
  }
  return out
}

/** 双语：生成插在原文段之后的灰色译文段落（复制原 pPr 保持样式） */
function translatedParagraph(paraXml: string, translation: string): string {
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  return (
    `<w:p>${pPr}<w:r><w:rPr><w:color w:val="64748B"/></w:rPr>` +
    `<w:t xml:space="preserve">${textToRunContent(translation)}</w:t></w:r></w:p>`
  )
}

async function buildDocx(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): Promise<BuiltFile> {
  const { zip, xml, paragraphs } = doc.state as DocxState

  // 从后往前替换，下标不失效
  let out = xml
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]
    const t = translations.get(p.segId)
    if (t === undefined) continue // 失败保留原文
    if (mode === 'translationOnly') {
      out = out.slice(0, p.start) + replaceParagraphText(p.xml, t) + out.slice(p.end)
    } else {
      out = out.slice(0, p.end) + translatedParagraph(p.xml, t) + out.slice(p.end)
    }
  }

  zip.file('word/document.xml', out)
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  })
  return { blob, filename: downloadName(doc.baseName, 'docx') }
}

export const docxParser: DocParser = {
  exts: ['docx'],
  parse: parseDocx,
  build: buildDocx,
}
