/**
 * SRT / VTT / ASS 字幕解析器。
 * - 时间轴行、序号行、注释块、ASS 元数据字段一律作为骨架保留，不进入翻译；
 * - SRT/VTT 以 cue 为单位：时间轴之后的多行对白合并为一个片段；
 * - ASS 只处理 Dialogue: 行：前 9 个逗号字段是元数据，只译第 10 段（台词）；
 *   句首 {\...} 特效块剥离保留，回写时重新拼上；
 * - build：SRT/VTT 双语 = 每条 cue 原文行下加译文行；ASS 双语 = 原文\N译文；
 *   仅译文 = 只保留译文（失败 cue 保留原文）。
 */
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

const TIMELINE_RE = /(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}/

interface Cue {
  /** 骨架头行（序号行 / cue 标识行 + 时间轴行） */
  header: string[]
  /** 对白行（原文） */
  textLines: string[]
  segId: number
}

interface TimedState {
  kind: 'srt' | 'vtt'
  /** 文件头（VTT 的 WEBVTT 行及头部注释；SRT 为空） */
  preamble: string[]
  /** 顺序块：cue 或骨架行组 */
  parts: Array<{ cue: Cue } | { literal: string[] }>
  eol: string
}

function parseTimed(buf: ArrayBuffer, name: string, kind: 'srt' | 'vtt'): ParsedDoc {
  const raw = new TextDecoder('utf-8').decode(buf)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^﻿/, '')
  const lines = text.split('\n')

  const preamble: string[] = []
  const parts: TimedState['parts'] = []
  const segments: { id: number; text: string }[] = []

  let i = 0
  if (kind === 'vtt') {
    // 头部：WEBVTT 行 + 到第一个空行为止
    if (lines[0] !== undefined && lines[0].trimStart().startsWith('WEBVTT')) {
      preamble.push(lines[0])
      i = 1
      while (i < lines.length && lines[i].trim() !== '') {
        preamble.push(lines[i])
        i++
      }
    }
  }

  let literal: string[] = []
  const flushLiteral = (): void => {
    if (literal.length > 0) {
      parts.push({ literal })
      literal = []
    }
  }

  while (i < lines.length) {
    // 跳过空行
    if (lines[i].trim() === '') { i++; continue }
    // 收集一个块（到空行为止）
    const block: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      block.push(lines[i])
      i++
    }
    // VTT NOTE 注释块：骨架
    if (kind === 'vtt' && block[0].startsWith('NOTE')) {
      literal.push(...block)
      continue
    }
    // 找时间轴行
    const tlIdx = block.findIndex((l) => TIMELINE_RE.test(l))
    if (tlIdx < 0) {
      // 无时间轴：整块骨架（容错）
      literal.push(...block)
      continue
    }
    const textLines = block.slice(tlIdx + 1)
    if (textLines.length === 0 || !textLines.some((l) => l.trim() !== '')) {
      literal.push(...block)
      continue
    }
    flushLiteral()
    const segId = segments.length
    segments.push({ id: segId, text: textLines.join('\n') })
    parts.push({ cue: { header: block.slice(0, tlIdx + 1), textLines, segId } })
  }
  flushLiteral()

  const state: TimedState = { kind, preamble, parts, eol }
  return { kind, baseName: baseNameOf(name), segments, state }
}

function buildTimed(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { preamble, parts, eol } = doc.state as TimedState
  const blocks: string[] = []
  if (preamble.length > 0) blocks.push(preamble.join(eol))
  for (const part of parts) {
    if ('literal' in part) {
      blocks.push(part.literal.join(eol))
      continue
    }
    const { cue } = part
    const t = translations.get(cue.segId)
    const lines: string[] = [...cue.header]
    if (mode === 'bilingual') {
      lines.push(...cue.textLines)
      if (t !== undefined) lines.push(...t.split('\n'))
    } else {
      lines.push(...(t !== undefined ? t.split('\n') : cue.textLines))
    }
    blocks.push(lines.join(eol))
  }
  const content = blocks.join(eol + eol) + eol
  return {
    blob: new Blob([content], { type: 'text/plain;charset=utf-8' }),
    filename: downloadName(doc.baseName, doc.kind),
  }
}

// ===== ASS =====

interface AssLine {
  /** 原始行（骨架行原样保留） */
  raw: string
  segId: number
  /** Dialogue 行的元数据前缀（"Dialogue: ...,...," 到第 9 个逗号为止，含逗号后的内容起点） */
  metaPrefix: string
  /** 句首特效块（可能多个连续 {\...}） */
  overridePrefix: string
  /** 台词原文（剥离特效块后） */
  dialogue: string
}

interface AssState {
  lines: AssLine[]
  eol: string
}

/** 返回第 9 个逗号之后（台词起点）的下标；不足 9 个逗号返回 -1 */
function nthComma(s: string, n: number): number {
  let idx = -1
  for (let k = 0; k < n; k++) {
    idx = s.indexOf(',', idx + 1)
    if (idx < 0) return -1
  }
  return idx + 1
}

/** 剥离句首连续特效块 {\...}，返回 [特效前缀, 剩余台词] */
function splitOverride(text: string): [string, string] {
  let rest = text
  let prefix = ''
  while (rest.startsWith('{')) {
    const close = rest.indexOf('}')
    if (close < 0) break
    prefix += rest.slice(0, close + 1)
    rest = rest.slice(close + 1)
  }
  return [prefix, rest]
}

function parseAss(buf: ArrayBuffer, name: string): ParsedDoc {
  const raw = new TextDecoder('utf-8').decode(buf)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^﻿/, '')
  const rawLines = text.split('\n')

  const lines: AssLine[] = []
  const segments: { id: number; text: string }[] = []

  for (const rawLine of rawLines) {
    if (!rawLine.startsWith('Dialogue:')) {
      lines.push({ raw: rawLine, segId: -1, metaPrefix: '', overridePrefix: '', dialogue: '' })
      continue
    }
    const start = nthComma(rawLine, 9)
    if (start < 0) {
      lines.push({ raw: rawLine, segId: -1, metaPrefix: '', overridePrefix: '', dialogue: '' })
      continue
    }
    const metaPrefix = rawLine.slice(0, start)
    const [overridePrefix, dialogue] = splitOverride(rawLine.slice(start))
    if (dialogue.trim() === '') {
      lines.push({ raw: rawLine, segId: -1, metaPrefix: '', overridePrefix: '', dialogue: '' })
      continue
    }
    const segId = segments.length
    segments.push({ id: segId, text: dialogue })
    lines.push({ raw: rawLine, segId, metaPrefix, overridePrefix, dialogue })
  }

  const state: AssState = { lines, eol }
  return { kind: 'ass', baseName: baseNameOf(name), segments, state }
}

function buildAss(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { lines, eol } = doc.state as AssState
  const out = lines.map((l) => {
    if (l.segId < 0) return l.raw
    const t = translations.get(l.segId)
    if (mode === 'bilingual') {
      return t !== undefined
        ? `${l.metaPrefix}${l.overridePrefix}${l.dialogue}\\N${t}`
        : l.raw
    }
    return t !== undefined
      ? `${l.metaPrefix}${l.overridePrefix}${t}`
      : l.raw
  })
  return {
    blob: new Blob([out.join(eol)], { type: 'text/plain;charset=utf-8' }),
    filename: downloadName(doc.baseName, 'ass'),
  }
}

// ===== 导出 parser =====

export const srtParser: DocParser = {
  exts: ['srt'],
  parse: (buf, name) => Promise.resolve(parseTimed(buf, name, 'srt')),
  build: buildTimed,
}

export const vttParser: DocParser = {
  exts: ['vtt'],
  parse: (buf, name) => Promise.resolve(parseTimed(buf, name, 'vtt')),
  build: buildTimed,
}

export const assParser: DocParser = {
  exts: ['ass', 'ssa'],
  parse: (buf, name) => Promise.resolve(parseAss(buf, name)),
  build: buildAss,
}
