/**
 * 文档翻译 — 解析器统一契约。
 *
 * 管线（与 reference/analysis/doc-translation-research.md §0 一致）：
 *   文件 → parse → ParsedDoc（骨架留在 parser 内部，segments 为可翻译片段）
 *        → 批量翻译 segments.text
 *        → build(doc, translations, mode) → { blob, filename } 下载
 *
 * 约定：
 * - segments 的 id 从 0 开始连续编号，translations 以 id 为键回填；
 *   缺失（翻译失败）的 id 一律保留原文。
 * - 骨架（时间轴、标签、JSON 结构、XML 标记）永不进入 segments。
 */

export interface ParsedSegment {
  id: number
  text: string
}

export interface ParsedDoc {
  /** 格式标识：'txt' | 'markdown' | 'srt' | 'vtt' | 'ass' | 'json' | 'html' | 'epub' | 'docx' | 'pdf' */
  kind: string
  /** 原始文件名（不含扩展名），build 生成下载名时用 */
  baseName: string
  segments: ParsedSegment[]
  /** parser 私有状态（骨架/结构），build 时原样取回 */
  state: unknown
}

export type OutputMode = 'bilingual' | 'translationOnly'

export interface BuiltFile {
  blob: Blob
  filename: string
}

export interface DocParser {
  /** 本 parser 负责的扩展名（小写、不含点），如 ['txt'] / ['srt','vtt','ass'] */
  exts: string[]
  /** 解析文件内容；buf 为完整文件字节，name 为文件名（含扩展名） */
  parse(buf: ArrayBuffer, name: string): Promise<ParsedDoc>
  /**
   * 回写译文并产出下载文件。
   * - translations：id → 译文；缺失的 id 保留原文。
   * - mode：bilingual = 双语对照；translationOnly = 仅译文。
   * - ZIP 组（epub/docx）需要重打包，允许返回 Promise。
   */
  build(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile | Promise<BuiltFile>
}

/** 文件名工具：去扩展名取 base；下载名 = base + _已翻译 + .ext */
export function baseNameOf(name: string): string {
  const n = name.replace(/[\\/]/g, '')
  const dot = n.lastIndexOf('.')
  return dot > 0 ? n.slice(0, dot) : n
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 生成下载文件名：{base}_已翻译.{ext}（epub 双语/仅译文同规则，PDF 导出 .html 由 parser 自己改扩展名） */
export function downloadName(base: string, ext: string): string {
  return `${base}_已翻译.${ext}`
}
