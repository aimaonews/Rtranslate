// PageTranslator：整页双语翻译编排。
// IntersectionObserver 可见才译 + 并发队列 + MutationObserver 动态跟进 + 完全可逆开关。
import { findCandidates, extractText, buildTranslationHtml } from './dom'
import { injectTranslation, removeAllTranslations, showLoading, showError, clearStatus } from './render'
import { normalizeText, sameText, splitLongText } from '../core/text'
import type { Config } from '../shared/config'
import type { BgResponse, TranslateResult } from '../shared/protocol'

const MAX_CONCURRENT = 4
const IO_ROOT_MARGIN = '1000px 0px'
const LONG_TEXT_SPLIT = 1500
const MO_DEBOUNCE_MS = 120
const CTX_DESC_MAX = 200
const CTX_BODY_MAX = 400
const CTX_TOTAL_MAX = 800

// 页面级上下文缓存：整页翻译期间所有段落共享同一份，不每段重取。
// undefined = 页面无可用上下文；null = 尚未提取。
let pageContextCache: string | undefined | null = null

/**
 * 全页摘要上下文（contextAware.enabled 时随 translate 消息发送，仅 AI 引擎使用）：
 * 标题 + meta description（截 200）+ 正文前 400 字符（空白归一化），总长截 800。
 * 页面无任何可用片段时返回 undefined。结果模块级缓存一次。
 */
export function getPageContext(): string | undefined {
  if (pageContextCache !== null) return pageContextCache
  const parts: string[] = []
  const title = document.title?.trim()
  if (title) parts.push(title)
  const desc = document
    .querySelector('meta[name="description"]')
    ?.getAttribute('content')
    ?.trim()
  if (desc) parts.push(desc.slice(0, CTX_DESC_MAX))
  // jsdom 无 innerText 实现，退 textContent（浏览器环境恒走 innerText）
  const bodyText = normalizeText(document.body?.innerText ?? document.body?.textContent ?? '')
  if (bodyText) parts.push(bodyText.slice(0, CTX_BODY_MAX))
  const joined = parts.join('\n').slice(0, CTX_TOTAL_MAX)
  pageContextCache = joined.length > 0 ? joined : undefined
  return pageContextCache
}

/** 清空页面上下文缓存（测试与 SPA 路由切换时用）。 */
export function resetPageContext(): void {
  pageContextCache = null
}

async function requestTranslate(text: string, config: Config): Promise<TranslateResult> {
  const resp = (await chrome.runtime.sendMessage({
    kind: 'translate',
    text,
    targetLang: config.general.targetLang,
    sourceLang: config.general.sourceLang,
    // 仅开关开启时附带页面上下文；机器引擎在 background 侧忽略
    ...(config.contextAware.enabled ? { context: getPageContext() } : {}),
  })) as BgResponse<TranslateResult>
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

/** 长文按句切分后顺序翻译拼接 */
async function translateLongText(text: string, config: Config): Promise<string> {
  if (text.length <= LONG_TEXT_SPLIT) {
    const r = await requestTranslate(text, config)
    return r.text
  }
  const parts = splitLongText(text, LONG_TEXT_SPLIT)
  const out: string[] = []
  for (const part of parts) {
    const r = await requestTranslate(part, config)
    out.push(r.text)
  }
  return out.join('\n')
}

/** 立即翻译单个元素（悬停翻译复用）。返回是否成功注入。 */
export async function translateElement(el: Element, config: Config): Promise<boolean> {
  if (el.hasAttribute('data-tv-translated')) return true
  const extracted = extractText(el)
  if (!extracted) return false
  showLoading(el)
  try {
    const translated = await translateLongText(extracted.text, config)
    clearStatus(el)
    if (sameText(translated, extracted.text)) {
      el.setAttribute('data-tv-translated', 'skipped')
      return true
    }
    injectTranslation(el, buildTranslationHtml(translated, extracted.placeholders), config)
    return true
  } catch (err) {
    showError(el, {
      message: err instanceof Error ? err.message : String(err),
      onRetry: () => void translateElement(el, config),
    })
    return false
  }
}

export class PageTranslator {
  private getConfig: () => Config
  private io: IntersectionObserver | null = null
  private mo: MutationObserver | null = null
  private pending = new Set<Element>()
  private running = 0
  private moTimer: ReturnType<typeof setTimeout> | null = null
  private activeFlag = false
  translatedCount = 0
  failedCount = 0

  constructor(getConfig: () => Config) {
    this.getConfig = getConfig
  }

  isActive(): boolean {
    return this.activeFlag
  }

  counts(): { translatedCount: number; failedCount: number } {
    return { translatedCount: this.translatedCount, failedCount: this.failedCount }
  }

  /** 切换整页翻译状态，返回切换后状态 */
  async toggle(): Promise<boolean> {
    if (this.activeFlag) {
      this.deactivate()
      return false
    }
    this.activate()
    return true
  }

  private activate() {
    this.activeFlag = true
    this.translatedCount = 0
    this.failedCount = 0
    this.scan(document.body)
    this.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as Element
          this.io?.unobserve(el)
          this.enqueue(el)
        }
      },
      { rootMargin: IO_ROOT_MARGIN, threshold: 0 },
    )
    this.mo = new MutationObserver((records) => this.onMutations(records))
    this.mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  private deactivate() {
    this.activeFlag = false
    this.io?.disconnect()
    this.io = null
    this.mo?.disconnect()
    this.mo = null
    if (this.moTimer) clearTimeout(this.moTimer)
    this.pending.clear()
    this.running = 0
    document.querySelectorAll('[data-tv-translated]').forEach((el) => el.removeAttribute('data-tv-translated'))
    removeAllTranslations()
  }

  /** 扫描根节点下的候选并交给 IO/队列 */
  scan(root: ParentNode) {
    if (!this.activeFlag || !root) return
    const config = this.getConfig()
    const candidates = findCandidates(root, config.general.targetLang)
    for (const el of candidates) {
      if (el.hasAttribute('data-tv-queued')) continue
      el.setAttribute('data-tv-queued', '1')
      if (this.io) this.io.observe(el)
      else this.enqueue(el)
    }
  }

  private onMutations(records: MutationRecord[]) {
    const added: Element[] = []
    for (const r of records) {
      const target = r.target
      if (target instanceof Element && target.closest('[data-tv-owned], tv-translation')) continue
      if (r.type === 'characterData') {
        const parent = target.parentElement
        if (parent) added.push(parent)
        continue
      }
      for (const node of Array.from(r.addedNodes)) {
        if (node instanceof Element) {
          if (node.hasAttribute('data-tv-owned') || node.tagName === 'TV-TRANSLATION') continue
          added.push(node)
        }
      }
    }
    if (!added.length) return
    if (this.moTimer) clearTimeout(this.moTimer)
    this.moTimer = setTimeout(() => {
      if (!this.activeFlag) return
      for (const el of added) {
        if (el.isConnected) this.scan(el)
      }
    }, MO_DEBOUNCE_MS)
  }

  private enqueue(el: Element) {
    el.removeAttribute('data-tv-queued')
    if (el.hasAttribute('data-tv-translated') || !el.isConnected) return
    if (this.running >= MAX_CONCURRENT) {
      this.pending.add(el)
      return
    }
    void this.process(el)
  }

  private drain() {
    while (this.running < MAX_CONCURRENT && this.pending.size) {
      const el = this.pending.values().next().value as Element
      this.pending.delete(el)
      if (!el.isConnected) continue
      void this.process(el)
    }
  }

  private async process(el: Element) {
    this.running += 1
    try {
      const before = el.hasAttribute('data-tv-translated')
      const ok = await translateElement(el, this.getConfig())
      if (ok && !before) this.translatedCount += 1
      if (!ok) this.failedCount += 1
    } finally {
      this.running -= 1
      this.drain()
    }
  }
}
