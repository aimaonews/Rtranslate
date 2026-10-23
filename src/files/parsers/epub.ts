/**
 * ePub 解析器（JSZip）。
 * 管线：解包 → META-INF/container.xml 找 OPF → spine 顺序取 XHTML 章节
 *      → 每章 DOMParser 提取语义块文本片段 → 回写译文 → 重打包。
 * 硬性约束：
 * - mimetype 必须是 ZIP 第一条且无压缩（STORE）——重打包时显式第一个写入；
 * - ZIP 条目总数 ≤ 10000、解压总大小 ≤ 200MB（防 zip bomb）；
 * - META-INF/encryption.xml 存在即视为 DRM 加密，直接报错。
 */
import { JSZip, type JSZipInstance } from './jszip'
import { isMeaningfulText, normalizeText } from '../../core/text'
import { applyTranslation, collectSemanticElements } from './htmlParser'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

const MAX_ENTRIES = 10000
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024 // 200MB

interface Chapter {
  /** zip 内路径 */
  path: string
  /** 原始文本（回写时取 XML 声明/DOCTYPE 前缀） */
  source: string
  /** 解析后的文档 */
  doc: Document
  /** 是否为 XHTML 模式（false = text/html 兜底解析） */
  xhtml: boolean
  /** 本章参与翻译的元素（与 segment id 通过 segStart + 下标对应） */
  elements: Element[]
  segStart: number
}

interface EpubState {
  zip: JSZipInstance
  chapters: Chapter[]
}

/** 相对路径解析：把 href 相对 opfDir 归一化为 zip 内路径 */
function resolvePath(opfDir: string, href: string): string {
  const parts = (opfDir ? `${opfDir}/` : '').split('/').filter(Boolean)
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.querySelector('parsererror') ? null : doc
}

/** 解析章节 XHTML：优先 application/xhtml+xml，失败兜底 text/html */
function parseChapter(source: string): { doc: Document; xhtml: boolean } {
  const asXml = new DOMParser().parseFromString(source, 'application/xhtml+xml')
  if (!asXml.querySelector('parsererror') && asXml.documentElement) {
    return { doc: asXml, xhtml: true }
  }
  return { doc: new DOMParser().parseFromString(source, 'text/html'), xhtml: false }
}

async function parseEpub(buf: ArrayBuffer, name: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buf)

  // 安全上限
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ePub 条目过多（${entries.length} > ${MAX_ENTRIES}），拒绝处理`)
  }
  let total = 0
  for (const e of entries) {
    total += (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error('ePub 解压总大小超过 200MB，拒绝处理')
    }
  }

  // mimetype 校验
  const mimetypeEntry = zip.file('mimetype')
  if (!mimetypeEntry) throw new Error('不是合法的 ePub：缺少 mimetype')
  const mimetype = (await mimetypeEntry.async('string')).trim()
  if (mimetype !== 'application/epub+zip') throw new Error('不是合法的 ePub：mimetype 不符')

  // DRM 检查
  if (zip.file('META-INF/encryption.xml')) {
    throw new Error('该 ePub 含 DRM 加密，无法翻译')
  }

  // container.xml → OPF 路径
  const containerText = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerText) throw new Error('ePub 缺少 META-INF/container.xml')
  const container = parseXml(containerText)
  const rootfile = container?.querySelector('rootfile')
  const opfPath = rootfile?.getAttribute('full-path')
  if (!opfPath) throw new Error('container.xml 中找不到 OPF 路径')

  // OPF → manifest + spine
  const opfText = await zip.file(opfPath)?.async('string')
  if (!opfText) throw new Error(`ePub 缺少 OPF 文件：${opfPath}`)
  const opf = parseXml(opfText)
  if (!opf) throw new Error('OPF 解析失败')
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''

  const manifest = new Map<string, { path: string; mediaType: string }>()
  for (const item of Array.from(opf.querySelectorAll('manifest > item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const mediaType = item.getAttribute('media-type') ?? ''
    if (id && href) manifest.set(id, { path: resolvePath(opfDir, href), mediaType })
  }

  const spinePaths: string[] = []
  for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
    const idref = ref.getAttribute('idref')
    const item = idref ? manifest.get(idref) : undefined
    if (!item) continue
    if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html' || item.mediaType === 'text/xml') {
      spinePaths.push(item.path)
    }
  }
  if (spinePaths.length === 0) throw new Error('ePub spine 中没有可翻译的内容文档')

  // 逐章提取片段
  const chapters: Chapter[] = []
  const segments: { id: number; text: string }[] = []
  for (const path of spinePaths) {
    const source = await zip.file(path)?.async('string')
    if (source === undefined) continue
    const { doc, xhtml } = parseChapter(source)
    const elements: Element[] = []
    const segStart = segments.length
    for (const el of collectSemanticElements(doc)) {
      const t = normalizeText(el.textContent ?? '')
      if (!isMeaningfulText(t)) continue
      segments.push({ id: segments.length, text: t })
      elements.push(el)
    }
    chapters.push({ path, source, doc, xhtml, elements, segStart })
  }
  if (segments.length === 0) throw new Error('ePub 中没有可翻译的文本')

  const state: EpubState = { zip, chapters }
  return { kind: 'epub', baseName: baseNameOf(name), segments, state }
}

/** 序列化章节：保留原始 XML 声明 / DOCTYPE 前缀 */
function serializeChapter(ch: Chapter): string {
  let out: string
  if (ch.xhtml) {
    out = new XMLSerializer().serializeToString(ch.doc)
    // 原始文件中根元素之前的声明前缀（<?xml ...?>、DOCTYPE）
    const m = ch.source.match(/^[\s\S]*?(?=<html[\s>])/)
    const prefix = m ? m[0] : ''
    // XMLSerializer 输出从根元素开始；若前缀含 xml 声明/DOCTYPE 且输出未含，则补上
    if (prefix && !out.startsWith('<?xml')) return prefix + out
    return out
  }
  return '<!DOCTYPE html>\n' + ch.doc.documentElement.outerHTML
}

async function buildEpub(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): Promise<BuiltFile> {
  const { zip, chapters } = doc.state as EpubState

  // 回写各章
  const modified = new Map<string, string>()
  for (const ch of chapters) {
    let touched = false
    for (let i = 0; i < ch.elements.length; i++) {
      const t = translations.get(ch.segStart + i)
      if (t === undefined) continue
      applyTranslation(ch.elements[i], t, mode, ch.xhtml)
      touched = true
    }
    if (touched) modified.set(ch.path, serializeChapter(ch))
  }

  // 重打包：mimetype 第一条且 STORE，其余按原顺序（修改过的章节写新内容）
  const out = new JSZip()
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path === 'mimetype' || entry.dir) continue
    const next = modified.get(path)
    if (next !== undefined) {
      out.file(path, next, { compression: 'DEFLATE' })
    } else {
      out.file(path, await entry.async('uint8array'), { compression: 'DEFLATE' })
    }
  }
  const blob = await out.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  })
  return { blob, filename: downloadName(doc.baseName, 'epub') }
}

export const epubParser: DocParser = {
  exts: ['epub'],
  parse: parseEpub,
  build: buildEpub,
}
