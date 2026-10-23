/**
 * TXT / Markdown 解析器：按段落（空行分隔）切片段。
 * - Markdown 额外保护围栏代码块（``` / ~~~）与 frontmatter，整块作为骨架不翻译；
 * - 无翻译价值的段落（纯数字、URL、标识符等）保留为骨架；
 * - 回写按"原始行数组 + 段落行区间"重建，空行与骨架行原样保留；
 * - 双语 = 原文段落后紧跟译文行；仅译文 = 段落行替换为译文。
 */
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

interface TextBlock {
  /** 段落起始行（含） */
  start: number
  /** 段落结束行（不含） */
  end: number
  segId: number
}

interface TextState {
  lines: string[]
  blocks: TextBlock[]
  eol: string
}

/** Markdown 骨架判定：围栏代码块 / frontmatter / 水平线 */
function markdownSkeleton(lines: string[]): boolean[] {
  const skeleton = new Array<boolean>(lines.length).fill(false)
  let inFence = false
  let fenceMarker = ''
  // frontmatter：文件首行为 --- 时，到下一个 --- 为止全部骨架
  let i = 0
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    skeleton[0] = true
    i = 1
    while (i < lines.length) {
      skeleton[i] = true
      if (lines[i].trim() === '---' || lines[i].trim() === '...') {
        i++
        break
      }
      i++
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0] // ` 或 ~
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
      skeleton[i] = true
      continue
    }
    if (inFence) {
      skeleton[i] = true
      continue
    }
    // 水平线
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) skeleton[i] = true
  }
  return skeleton
}

function parseText(buf: ArrayBuffer, name: string, isMarkdown: boolean): ParsedDoc {
  const raw = new TextDecoder('utf-8').decode(buf)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')
  const skeleton = isMarkdown ? markdownSkeleton(lines) : lines.map(() => false)

  // 空行分隔段落；骨架行不参与段落
  const blocks: TextBlock[] = []
  const segments: { id: number; text: string }[] = []
  let start = -1

  const flush = (endExclusive: number): void => {
    if (start < 0) return
    const blockText = lines.slice(start, endExclusive).join('\n')
    const s = start
    start = -1
    if (!isMeaningfulText(blockText)) return
    const segId = segments.length
    segments.push({ id: segId, text: blockText })
    blocks.push({ start: s, end: endExclusive, segId })
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '' || skeleton[i]) {
      flush(i)
      continue
    }
    if (start < 0) start = i
  }
  flush(lines.length)

  const state: TextState = { lines, blocks, eol }
  return { kind: isMarkdown ? 'markdown' : 'txt', baseName: baseNameOf(name), segments, state }
}

function buildText(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { lines, blocks, eol } = doc.state as TextState
  const ext = doc.kind === 'markdown' ? 'md' : 'txt'
  const byStart = new Map<number, TextBlock>()
  for (const b of blocks) byStart.set(b.start, b)

  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const block = byStart.get(i)
    if (!block) {
      out.push(lines[i])
      i++
      continue
    }
    const t = translations.get(block.segId)
    if (mode === 'bilingual') {
      out.push(...lines.slice(block.start, block.end))
      if (t !== undefined) out.push(t)
    } else {
      out.push(t ?? lines.slice(block.start, block.end).join('\n'))
    }
    i = block.end
  }
  return {
    blob: new Blob([out.join(eol)], { type: 'text/plain;charset=utf-8' }),
    filename: downloadName(doc.baseName, ext),
  }
}

export const textParser: DocParser = {
  exts: ['txt'],
  parse: (buf, name) => Promise.resolve(parseText(buf, name, false)),
  build: buildText,
}

export const markdownParser: DocParser = {
  exts: ['md', 'markdown'],
  parse: (buf, name) => Promise.resolve(parseText(buf, name, true)),
  build: buildText,
}
