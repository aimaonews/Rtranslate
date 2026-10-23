/**
 * PDF 解析器（pdfjs-dist，MVP 路线：纯文本提取重排，不保版式）。
 * - getDocument → 每页 getTextContent → 按 y 坐标聚行（容差 3px）→ 行距突变分段落；
 * - 扫描页（无文字）跳过；整份无文字报"扫描件不支持"；
 * - build 导出双语 HTML（原文段落 + 灰色译文段落，带页码分隔），扩展名 .html。
 * worker：public/pdf.worker.min.js（构建时进 dist，chrome.runtime.getURL 取用）。
 */
import * as pdfjs from 'pdfjs-dist'
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js')

const LINE_Y_TOLERANCE = 3

interface PdfParagraph {
  pageNo: number
  segId: number
  text: string
}

interface PdfState {
  base: string
  pages: Array<{ pageNo: number; paras: PdfParagraph[] }>
}

interface TextItemLike {
  str: string
  transform: number[]
  height: number
}

interface Line {
  y: number
  height: number
  items: TextItemLike[]
}

/** 行内片段拼接：CJK 边界不加空格，其余加一个空格 */
function joinPieces(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  const left = a.charCodeAt(a.length - 1)
  const right = b.charCodeAt(0)
  const cjk = (c: number): boolean =>
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef)
  return cjk(left) || cjk(right) ? a + b : `${a} ${b}`
}

/** 一页的 text items → 段落文本列表 */
function pageToParagraphs(items: TextItemLike[]): string[] {
  // 1) 按 y 聚行（容差 3px），保持内容流顺序
  const lines: Line[] = []
  for (const item of items) {
    if (!item.str || item.str.trim() === '') continue
    const y = item.transform[5]
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - y) <= LINE_Y_TOLERANCE) {
      last.items.push(item)
      last.height = Math.max(last.height, item.height)
    } else {
      lines.push({ y, height: item.height || 10, items: [item] })
    }
  }
  if (lines.length === 0) return []
  // 2) 行内按 x 排序后拼接
  const lineTexts = lines.map((line) => {
    const sorted = [...line.items].sort((a, b) => a.transform[4] - b.transform[4])
    return sorted.map((i) => i.str).join('').trim()
  })
  // 3) 行距突变分段：相邻行 y 差 > 1.8 倍行高 → 新段落
  const paras: string[] = []
  let cur = ''
  for (let i = 0; i < lines.length; i++) {
    const text = lineTexts[i]
    if (i > 0) {
      const gap = Math.abs(lines[i - 1].y - lines[i].y)
      const lineHeight = Math.max(lines[i - 1].height, lines[i].height)
      if (gap > lineHeight * 1.8) {
        if (cur) paras.push(cur)
        cur = ''
      }
    }
    cur = joinPieces(cur, text)
  }
  if (cur) paras.push(cur)
  return paras.filter((p) => p.length > 0)
}

async function parsePdf(buf: ArrayBuffer, name: string): Promise<ParsedDoc> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    cMapUrl: chrome.runtime.getURL('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('pdfjs/standard_fonts/'),
  })
  const pdf = await task.promise

  const segments: { id: number; text: string }[] = []
  const pages: PdfState['pages'] = []
  let scannedPages = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: TextItemLike[] = []
    for (const it of content.items) {
      if ('str' in it) {
        items.push({ str: it.str, transform: it.transform as number[], height: it.height as number })
      }
    }
    if (items.length === 0) {
      scannedPages++
      continue
    }
    const paras: PdfParagraph[] = []
    for (const text of pageToParagraphs(items)) {
      if (!isMeaningfulText(text)) continue
      const segId = segments.length
      segments.push({ id: segId, text })
      paras.push({ pageNo: p, segId, text })
    }
    pages.push({ pageNo: p, paras })
    // 大文件让出主线程
    if (p % 10 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  void task.destroy()

  if (segments.length === 0) {
    throw new Error(
      scannedPages > 0 ? '该 PDF 是扫描件（无文字层），暂不支持翻译' : 'PDF 中没有可翻译的文本',
    )
  }

  const base = baseNameOf(name)
  const state: PdfState = { base, pages }
  return { kind: 'pdf', baseName: base, segments, state }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const EXPORT_CSS = `
  body { max-width: 820px; margin: 0 auto; padding: 32px 20px 60px;
         font: 15px/1.8 -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
         color: #1e293b; }
  h1 { font-size: 20px; margin: 0 0 24px; }
  .page-num { margin: 28px 0 12px; padding-top: 14px; border-top: 1px dashed #cbd5e1;
              font-size: 12px; color: #94a3b8; }
  .para { margin: 0 0 14px; }
  .orig { margin: 0; }
  .trans { margin: 4px 0 0; color: #64748b; }
  .only .trans { color: #1e293b; margin: 0; }
`

function buildPdf(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { base, pages } = doc.state as PdfState
  const parts: string[] = [
    '<!DOCTYPE html>',
    `<html lang="zh-CN"><head><meta charset="utf-8" />`,
    `<title>${escapeHtml(base)}_已翻译</title>`,
    `<style>${EXPORT_CSS}</style></head>`,
    `<body class="${mode === 'translationOnly' ? 'only' : ''}">`,
    `<h1>${escapeHtml(base)}</h1>`,
  ]
  for (const page of pages) {
    if (page.paras.length === 0) continue
    parts.push(`<div class="page-num">第 ${page.pageNo} 页</div>`)
    for (const para of page.paras) {
      const t = translations.get(para.segId)
      if (mode === 'bilingual') {
        parts.push('<div class="para">')
        parts.push(`<p class="orig">${escapeHtml(para.text)}</p>`)
        if (t !== undefined) parts.push(`<p class="trans">${escapeHtml(t)}</p>`)
        parts.push('</div>')
      } else {
        parts.push(`<p class="trans">${escapeHtml(t ?? para.text)}</p>`)
      }
    }
  }
  parts.push('</body></html>')
  return {
    blob: new Blob([parts.join('\n')], { type: 'text/html;charset=utf-8' }),
    // PDF 导出双语 HTML，扩展名改为 .html
    filename: downloadName(doc.baseName, 'html'),
  }
}

export const pdfParser: DocParser = {
  exts: ['pdf'],
  parse: parsePdf,
  build: buildPdf,
}
