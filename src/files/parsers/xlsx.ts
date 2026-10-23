/**
 * XLSX 解析器（JSZip + 正则处理 xl/sharedStrings.xml，与 docx.ts 同套路）。
 * - 片段 = 每个 <si> 项聚合其全部 <t> 文本（含 <r> 富文本 run 的 <t>）；
 * - build 仅译文：第一个 <t> 替换为译文、清空其余 <t>；
 * - build 双语：值变为「原值 | 译文」（写回第一个 <t>，其余清空）；
 * - 无 xl/sharedStrings.xml 或其中无可翻译文本时抛「该文件无可翻译文本」；
 * - 写入的 <t> 统一带 xml:space="preserve"，避免首尾空白被 Excel 折叠；
 * - 全程 XML 转义/反转义；ZIP 条目数与解压总量上限（防 zip bomb，同 epub.ts）；
 *   重打包保持其余条目原样（worksheets/styles 等不动，单元格仍按索引引用 sharedStrings）。
 */
import { JSZip, type JSZipInstance } from './jszip'
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

const MAX_ENTRIES = 10000
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024 // 200MB

const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml'
/** <si> 项（实践中不会自闭合，但防御空项） */
const SI_RE = /<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g
/** <si> 内的文本节点 <t>（含 <r> run 内） */
const T_RE = /<t\b[^>]*>([\s\S]*?)<\/t>/g

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

/** 聚合 <si> 项纯文本 */
function siText(siXml: string): string {
  let out = ''
  T_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = T_RE.exec(siXml)) !== null) out += xmlUnescape(m[1])
  return out
}

interface XlsxItem {
  /** <si> 在 sharedStrings.xml 中的起止下标 */
  start: number
  end: number
  xml: string
  segId: number
  /** 解析时的原文（双语模式拼「原值 | 译文」用） */
  source: string
}

interface XlsxState {
  zip: JSZipInstance
  xml: string
  items: XlsxItem[]
}

async function parseXlsx(buf: ArrayBuffer, name: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) throw new Error('XLSX 条目过多，拒绝处理')
  let total = 0
  for (const e of entries) {
    total += (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error('XLSX 解压总大小超过 200MB，拒绝处理')
  }

  const entry = zip.file(SHARED_STRINGS_PATH)
  if (!entry) throw new Error('该文件无可翻译文本')
  const xml = await entry.async('string')

  const items: XlsxItem[] = []
  const segments: { id: number; text: string }[] = []
  SI_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SI_RE.exec(xml)) !== null) {
    const siXml = m[0]
    if (siXml.endsWith('/>')) continue // 空项
    const text = siText(siXml)
    if (!isMeaningfulText(text)) continue
    const segId = segments.length
    segments.push({ id: segId, text })
    items.push({ start: m.index, end: m.index + siXml.length, xml: siXml, segId, source: text })
  }
  if (segments.length === 0) throw new Error('该文件无可翻译文本')

  const state: XlsxState = { zip, xml, items }
  return { kind: 'xlsx', baseName: baseNameOf(name), segments, state }
}

/** 把 value 写回 <si>：第一个 <t> 承载全文（带 xml:space="preserve"），其余 <t> 清空 */
function writeSiValue(siXml: string, value: string): string {
  let firstT = true
  return siXml.replace(/<t\b([^>]*)>([\s\S]*?)<\/t>/g, (_whole, attrs: string) => {
    if (firstT) {
      firstT = false
      const space = attrs.includes('xml:space') ? attrs : `${attrs} xml:space="preserve"`
      return `<t${space}>${xmlEscape(value)}</t>`
    }
    return `<t${attrs}></t>`
  })
}

async function buildXlsx(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): Promise<BuiltFile> {
  const { zip, xml, items } = doc.state as XlsxState

  // 从后往前替换，下标不失效
  let out = xml
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    const t = translations.get(item.segId)
    if (t === undefined) continue // 失败保留原文
    const value = mode === 'bilingual' ? `${item.source} | ${t}` : t
    out = out.slice(0, item.start) + writeSiValue(item.xml, value) + out.slice(item.end)
  }

  zip.file(SHARED_STRINGS_PATH, out)
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  })
  return { blob, filename: downloadName(doc.baseName, 'xlsx') }
}

export const xlsxParser: DocParser = {
  exts: ['xlsx'],
  parse: parseXlsx,
  build: buildXlsx,
}
