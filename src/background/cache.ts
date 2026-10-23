/**
 * background/cache.ts — 翻译结果缓存。
 *
 * 内存 LRU（容量 500）+ chrome.storage.local 持久化（键 `tv:cache_v1`，契约 §4）。
 * 首次访问时惰性加载持久化内容（等价于启动 load）；写入先落内存，节流 2s 批量落盘；
 * 内存与加载两条路径超出容量都截断最旧项。落盘对象为 `{key: value}`，字符串键序
 * 保留插入序（即 LRU 序），加载时可据此截断。
 *
 * 本文件是 background 侧允许使用 chrome API 的文件之一。
 */

import { textHash } from '../core/text'

const CACHE_STORAGE_KEY = 'tv:cache_v1'
const MAX_ENTRIES = 500
const FLUSH_INTERVAL_MS = 2000

const lru = new Map<string, string>()
let loadPromise: Promise<void> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

function storageAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

async function ensureLoaded(): Promise<void> {
  if (!storageAvailable()) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const stored = await new Promise<unknown>((resolve) => {
      chrome.storage.local.get(CACHE_STORAGE_KEY, (result) => {
        resolve((result as Record<string, unknown> | undefined)?.[CACHE_STORAGE_KEY])
      })
    })
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const entries = Object.entries(stored as Record<string, unknown>)
      // 落盘对象保留 LRU 序；超容量截断最旧（保留最新 500 条）
      const keep = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
      for (const [k, v] of keep lru.set(k, String(v))
    }
  })()
  return loadPromise
}

async function writeThrough(): Promise<void> {
  if (!storageAvailable()) return
  dirty = false
  const snapshot = Object.fromEntries(lru)
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [CACHE_STORAGE_KEY]: snapshot }, () => resolve())
  })
}

/** 节流落盘：2s 窗口内的多次写入合并为一次 storage 写。 */
function scheduleFlush(): void {
  if (flushTimer || !storageAvailable()) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (dirty) void writeThrough()
  }, FLUSH_INTERVAL_MS)
}

/** 立即落盘（取消节流等待）。测试与非节流场景使用。 */
export async function flushCache(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!dirty) return
  await writeThrough()
}

/**
 * 缓存 key：引擎 id + 语言对 + 原文哈希 + promptSig 哈希（glossarySignature，
 * 术语表变更即自动失效，契约 §7）。promptSig 缺省为空串段。
 */
export function cacheKey(parts: {
  engine: string
  from: string
  to: string
  text: string
  promptSig?: string
}): string {
  const sig = parts.promptSig ? textHash(parts.promptSig) : ''
  return `tr|${parts.engine}|${parts.from}>${parts.to}|${textHash(parts.text)}|${sig}`
}

/** LRU 命中（触碰提为最新）；未命中返回 undefined。 */
export async function get(key: string): Promise<string | undefined> {
  await ensureLoaded()
  const value = lru.get(key)
  if (value !== undefined) {
    lru.delete(key)
    lru.set(key, value)
  }
  return value
}

/** 写入内存并调度节流落盘；超容量截断最旧项。 */
export async function set(key: string, value: string): Promise<void> {
  await ensureLoaded()
  lru.delete(key)
  lru.set(key, value)
  while (lru.size > MAX_ENTRIES) {
    const oldest = lru.keys().next().value
    if (oldest === undefined) break
    lru.delete(oldest)
  }
  dirty = true
  scheduleFlush()
}

/** 清空内存与持久化（立即落盘，不走节流）。 */
export async function clearAll(): Promise<void> {
  await ensureLoaded()
  lru.clear()
  dirty = true
  await flushCache()
}
