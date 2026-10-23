/**
 * JSON 解析器：递归遍历，只把"像自然语言"的字符串值作为片段。
 * - 判定复用 core/text.ts isMeaningfulText（长度>=4、含字母、非 URL/邮箱/纯标识符）；
 * - 遍历用显式栈（有界深度 1000），路径记录为 (string|number)[]；
 * - build：深拷贝后按路径回填，保持结构，JSON.stringify(_, null, 2)；
 *   双语 = "原值 | 译文"；仅译文 = 替换为译文（缺失保留原值）。
 */
import { isMeaningfulText } from '../../core/text'
import { baseNameOf, downloadName, type BuiltFile, type DocParser, type OutputMode, type ParsedDoc } from './types'

type PathSeg = string | number

interface JsonEntry {
  path: PathSeg[]
  segId: number
}

interface JsonState {
  root: unknown
  entries: JsonEntry[]
}

const MAX_DEPTH = 1000

/**
 * JSON 机器值过滤（在 isMeaningfulText 之上补充）：
 * 含数字且无空白 → 视为 ID/哈希/编码类标识符，不翻（研究报告 §1.6 jsonMachineValue）。
 */
function isTranslatableJsonValue(v: string): boolean {
  if (!isMeaningfulText(v, 4)) return false
  if (/\d/.test(v) && !/\s/.test(v)) return false
  return true
}

function parseJson(buf: ArrayBuffer, name: string): ParsedDoc {
  const text = new TextDecoder('utf-8').decode(buf)
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (e) {
    throw new Error(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`)
  }

  const entries: JsonEntry[] = []
  const segments: { id: number; text: string }[] = []
  // 显式栈遍历（值, 路径, 深度）
  const stack: Array<{ value: unknown; path: PathSeg[]; depth: number }> = [
    { value: root, path: [], depth: 0 },
  ]
  while (stack.length > 0) {
    const { value, path, depth } = stack.pop() as { value: unknown; path: PathSeg[]; depth: number }
    if (depth > MAX_DEPTH) continue
    if (typeof value === 'string') {
      if (isTranslatableJsonValue(value)) {
        const segId = segments.length
        segments.push({ id: segId, text: value })
        entries.push({ path, segId })
      }
      continue
    }
    if (Array.isArray(value)) {
      // 逆序入栈 → LIFO 弹出即文档序
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i], path: [...path, i], depth: depth + 1 })
      }
      continue
    }
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value).filter(
        // 跳过原型链危险键
        (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype',
      )
      for (let i = keys.length - 1; i >= 0; i--) {
        stack.push({
          value: (value as Record<string, unknown>)[keys[i]],
          path: [...path, keys[i]],
          depth: depth + 1,
        })
      }
    }
  }

  const state: JsonState = { root, entries }
  return { kind: 'json', baseName: baseNameOf(name), segments, state }
}

/** 按路径在深拷贝上设值 */
function setAtPath(root: unknown, path: PathSeg[], value: string): void {
  let cur = root
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    cur = Array.isArray(cur) ? cur[seg as number] : (cur as Record<string, unknown>)[seg as string]
  }
  const last = path[path.length - 1]
  if (Array.isArray(cur)) {
    cur[last as number] = value
  } else if (typeof cur === 'object' && cur !== null) {
    (cur as Record<string, unknown>)[last as string] = value
  }
}

function buildJson(doc: ParsedDoc, translations: Map<number, string>, mode: OutputMode): BuiltFile {
  const { root, entries } = doc.state as JsonState
  const clone: unknown = structuredClone(root)
  for (const { path, segId } of entries) {
    const t = translations.get(segId)
    if (t === undefined) continue
    // 原值从 clone 上按路径读取（与 entries 建立时一致）
    let cur: unknown = clone
    for (const seg of path) {
      cur = Array.isArray(cur) ? cur[seg as number] : (cur as Record<string, unknown>)[seg as string]
    }
    const orig = typeof cur === 'string' ? cur : ''
    setAtPath(clone, path, mode === 'bilingual' ? `${orig} | ${t}` : t)
  }
  return {
    blob: new Blob([JSON.stringify(clone, null, 2)], { type: 'application/json;charset=utf-8' }),
    filename: downloadName(doc.baseName, 'json'),
  }
}

export const jsonParser: DocParser = {
  exts: ['json'],
  parse: (buf, name) => Promise.resolve(parseJson(buf, name)),
  build: buildJson,
}
