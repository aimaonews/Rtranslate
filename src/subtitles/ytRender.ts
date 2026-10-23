// YouTube 双语字幕渲染：Shadow DOM 隔离面板 + timeupdate 二分查找 + 广告检测
import { getSubtitlesConfig, translateText, type SubtitleCue } from './types'
import type { BgResponse } from '../shared/protocol'

const HOST_ID = 'tv-yt-subtitle-host'
const NATIVE_HIDE_STYLE_ID = 'tv-yt-native-cap-hide'
const HOST_Z_INDEX = 45 // 高于原生字幕容器（~30），低于设置菜单

// ===== 单词化（纯函数，供测试） =====

export interface WordToken {
  type: 'word' | 'sep'
  text: string
}

/**
 * 拉丁系单词：Latin 字母/附标/数字，允许词内撇号（don't）与连字符（well-known）。
 * CJK（汉字/假名/谚文）不匹配 → 自然落入 sep，不拆。
 */
const WORD_RE = /[\p{Script=Latin}\p{M}\p{N}]+(?:[''’-][\p{Script=Latin}\p{M}\p{N}]+)*/gu

/** 把字幕原文拆成单词/分隔 token，拼接回原串恒等（word 可点击，sep 原样文本）。 */
export function wordifyText(text: string): WordToken[] {
  const tokens: WordToken[] = []
  if (!text) return tokens
  let last = 0
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index
    if (idx > last) tokens.push({ type: 'sep', text: text.slice(last, idx) })
    tokens.push({ type: 'word', text: m[0] })
    last = idx + m[0].length
  }
  if (last < text.length) tokens.push({ type: 'sep', text: text.slice(last) })
  return tokens
}

const EDGE_PUNCT_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

/** 去首尾标点/符号（保留词内撇号、连字符），供查词与存生词。 */
export function cleanWord(w: string): string {
  return w.trim().replace(EDGE_PUNCT_RE, '')
}

/**
 * 挂载在 #movie_player 内的双语字幕面板。
 * 全部文本走 textContent（YouTube 有 Trusted Types CSP，禁用 innerHTML）。
 */
export class YouTubeRenderer {
  private host: HTMLDivElement | null = null
  private panel: HTMLDivElement | null = null
  private origLine: HTMLDivElement | null = null
  private transLine: HTMLDivElement | null = null
  private cues: SubtitleCue[] = []
  private video: HTMLVideoElement | null = null
  private player: HTMLElement | null = null
  private adObserver: MutationObserver | null = null
  private currentCueStart = -1
  private enabled = true
  private adShowing = false
  // ===== 单词卡片 =====
  private wordCard: HTMLDivElement | null = null
  private cardSeq = 0 // 防竞态：旧卡片/旧单词的异步结果直接丢弃
  private cardTranslation: string | undefined
  private currentCueText: string | null = null
  private targetLang: string | null = null

  private readonly onTimeUpdate = (): void => this.syncToTime()
  private readonly onSeeked = (): void => {
    // seek 后两帧再强制同步一次，防错位
    requestAnimationFrame(() => requestAnimationFrame(() => this.syncToTime(true)))
  }

  /** 点击其他处关闭卡片；卡片内部点击经 composedPath 判断不关 */
  private readonly onDocClick = (e: Event): void => {
    if (!this.wordCard) return
    if (e.composedPath().includes(this.wordCard)) return
    this.closeWordCard()
  }

  private readonly onWordClick = (e: Event): void => {
    const t = e.target as HTMLElement | null
    if (!t?.classList?.contains('tv-yt-word')) return
    e.stopPropagation()
    const word = cleanWord(t.textContent ?? '')
    if (!word) return
    this.openWordCard(t, word)
  }

  mount(player: HTMLElement, video: HTMLVideoElement): void {
    this.destroy()
    this.player = player
    this.video = video

    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('data-tv-owned', '1')
    host.setAttribute('translate', 'no')
    host.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      `z-index:${HOST_Z_INDEX}`,
      'overflow:hidden',
    ].join(';')

    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '.tv-panel{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);',
      'max-width:82%;display:none;flex-direction:column;align-items:center;gap:4px;',
      'text-align:center;pointer-events:none;font-family:Roboto,Arial,sans-serif;}',
      '.tv-panel.tv-show{display:flex;}',
      '.tv-line{display:inline-block;background:rgba(0,0,0,.6);color:#fff;',
      'border-radius:10px;padding:2px 10px;line-height:1.4;white-space:pre-wrap;',
      'box-shadow:0 4px 12px rgba(15,23,42,.08);}',
      '.tv-orig{font-size:clamp(11px,1.7vmin,20px);opacity:.85;}',
      '.tv-trans{font-size:clamp(14px,2.4vmin,30px);font-weight:500;}',
      // 单词 span：面板整体 pointer-events:none，单词单独放开
      '.tv-yt-word{pointer-events:auto;cursor:pointer;border-radius:2px;}',
      '.tv-yt-word:hover{text-decoration:underline;}',
      // 查词卡片
      '.tv-word-card{position:absolute;pointer-events:auto;min-width:140px;max-width:260px;',
      'background:rgba(20,20,20,.95);color:#fff;border-radius:10px;padding:8px 10px;',
      'font-family:Roboto,Arial,sans-serif;font-size:13px;line-height:1.5;text-align:left;',
      'box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:6px;}',
      '.tv-wc-word{font-weight:600;font-size:15px;}',
      '.tv-wc-trans{opacity:.85;white-space:pre-wrap;}',
      '.tv-wc-save{align-self:flex-start;background:transparent;',
      'border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;',
      'padding:2px 8px;cursor:pointer;font-size:12px;font-family:inherit;}',
      '.tv-wc-save:hover{background:rgba(255,255,255,.12);}',
      '.tv-wc-save[disabled]{opacity:.6;cursor:default;border-color:transparent;}',
    ].join('')
    const panel = document.createElement('div')
    panel.className = 'tv-panel'
    const orig = document.createElement('div')
    orig.className = 'tv-line tv-orig'
    const trans = document.createElement('div')
    trans.className = 'tv-line tv-trans'
    orig.addEventListener('click', this.onWordClick)
    panel.appendChild(orig)
    panel.appendChild(trans)
    shadow.appendChild(style)
    shadow.appendChild(panel)

    player.appendChild(host)
    this.host = host
    this.panel = panel
    this.origLine = orig
    this.transLine = trans

    video.addEventListener('timeupdate', this.onTimeUpdate)
    video.addEventListener('seeked', this.onSeeked)

    // 广告检测：player class 含 ad-showing / ad-interrupting 时隐藏面板
    this.adShowing = this.isAdShowing()
    this.adObserver = new MutationObserver(() => {
      this.adShowing = this.isAdShowing()
      this.applyVisibility()
    })
    this.adObserver.observe(player, { attributes: true, attributeFilter: ['class'] })

    this.injectNativeHideStyle()
    this.currentCueStart = -1
    this.syncToTime(true)
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues
    this.currentCueStart = -1
    this.syncToTime(true)
  }

  /** 单条译文到达：就地更新，若正在显示则刷新 */
  updateCue(cue: SubtitleCue): void {
    if (cue.start * 1000 === this.currentCueStart) this.syncToTime(true)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    this.applyVisibility()
  }

  destroy(): void {
    this.closeWordCard()
    if (this.video) {
      this.video.removeEventListener('timeupdate', this.onTimeUpdate)
      this.video.removeEventListener('seeked', this.onSeeked)
    }
    this.adObserver?.disconnect()
    this.adObserver = null
    this.host?.remove()
    this.host = null
    this.panel = null
    this.origLine = null
    this.transLine = null
    this.video = null
    this.player = null
    this.currentCueStart = -1
    this.currentCueText = null
    document.getElementById(NATIVE_HIDE_STYLE_ID)?.remove()
  }

  // ===== 内部 =====

  private isAdShowing(): boolean {
    const cls = this.player?.classList
    return !!cls && (cls.contains('ad-showing') || cls.contains('ad-interrupting'))
  }

  /** 隐藏原生字幕容器（visibility 保留布局，防抖动） */
  private injectNativeHideStyle(): void {
    if (document.getElementById(NATIVE_HIDE_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = NATIVE_HIDE_STYLE_ID
    style.textContent = '.ytp-caption-window-container{visibility:hidden!important;}'
    document.head.appendChild(style)
  }

  /** 在按 start 升序的 cues 中二分查找 start <= t < end 的条目，O(log n) */
  private findCueIndex(tSec: number): number {
    const cues = this.cues
    let lo = 0
    let hi = cues.length - 1
    let candidate = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const cue = cues[mid]
      if (!cue) break
      if (cue.start <= tSec) {
        candidate = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (candidate === -1) return -1
    const cue = cues[candidate]
    return cue && tSec < cue.end ? candidate : -1
  }

  private syncToTime(force = false): void {
    const video = this.video
    if (!video || !this.panel) return
    const idx = this.findCueIndex(video.currentTime)
    const cue = idx >= 0 ? this.cues[idx] : undefined
    const key = cue ? cue.start * 1000 : -1
    if (!force && key === this.currentCueStart) return
    this.currentCueStart = key
    this.render(cue ?? null)
  }

  private render(cue: SubtitleCue | null): void {
    if (!this.panel || !this.origLine || !this.transLine) return
    this.closeWordCard()
    if (!cue) {
      this.currentCueText = null
      this.panel.classList.remove('tv-show')
      return
    }
    this.currentCueText = cue.text
    // 原文行：拆成单词 span（可点击查词）；译文行不拆
    this.origLine.textContent = ''
    for (const tok of wordifyText(cue.text)) {
      if (tok.type === 'word') {
        const span = document.createElement('span')
        span.className = 'tv-yt-word'
        span.textContent = tok.text
        this.origLine.appendChild(span)
      } else {
        this.origLine.appendChild(document.createTextNode(tok.text))
      }
    }
    this.transLine.textContent = cue.translation ?? '...'
    this.applyVisibility()
  }

  private applyVisibility(): void {
    if (!this.panel) return
    const show = this.enabled && !this.adShowing && this.currentCueStart !== -1
    this.panel.classList.toggle('tv-show', show)
  }

  // ===== 单词卡片 =====

  private closeWordCard(): void {
    this.cardSeq++
    this.wordCard?.remove()
    this.wordCard = null
    this.cardTranslation = undefined
    document.removeEventListener('click', this.onDocClick, true)
  }

  private async ensureTargetLang(): Promise<string> {
    if (this.targetLang) return this.targetLang
    const cfg = await getSubtitlesConfig()
    this.targetLang = cfg?.general.targetLang || 'zh-CN'
    return this.targetLang
  }

  /** 在被点单词旁（上方优先，空间不足放下方）弹出查词卡 */
  private openWordCard(anchor: HTMLElement, word: string): void {
    this.closeWordCard()
    const shadow = this.host?.shadowRoot
    if (!shadow || !this.host) return
    const seq = ++this.cardSeq

    const card = document.createElement('div')
    card.className = 'tv-word-card'
    const wordEl = document.createElement('div')
    wordEl.className = 'tv-wc-word'
    wordEl.textContent = word
    const transEl = document.createElement('div')
    transEl.className = 'tv-wc-trans'
    transEl.textContent = '...'
    const saveBtn = document.createElement('button')
    saveBtn.className = 'tv-wc-save'
    saveBtn.type = 'button'
    saveBtn.textContent = '☆ 收藏'
    card.appendChild(wordEl)
    card.appendChild(transEl)
    card.appendChild(saveBtn)

    // 定位：相对 host（inset:0 覆盖播放器），单词正上/下方居中
    const spanRect = anchor.getBoundingClientRect()
    const hostRect = this.host.getBoundingClientRect()
    card.style.left = `${spanRect.left - hostRect.left + spanRect.width / 2}px`
    if (spanRect.top - hostRect.top >= 140) {
      card.style.bottom = `${hostRect.bottom - spanRect.top + 8}px`
    } else {
      card.style.top = `${spanRect.bottom - hostRect.top + 8}px`
    }
    card.style.transform = 'translateX(-50%)'

    shadow.appendChild(card)
    this.wordCard = card
    document.addEventListener('click', this.onDocClick, true)

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      void this.saveCurrentWord(word, saveBtn)
    })

    // 异步加载译文；期间卡片被关/换词则丢弃结果
    void (async () => {
      try {
        const lang = await this.ensureTargetLang()
        const text = await translateText(word, lang)
        if (seq !== this.cardSeq || this.wordCard !== card) return
        this.cardTranslation = text
        transEl.textContent = text
      } catch {
        if (seq !== this.cardSeq || this.wordCard !== card) return
        transEl.textContent = '—'
      }
    })()
  }

  private async saveCurrentWord(word: string, btn: HTMLButtonElement): Promise<void> {
    if (btn.disabled) return
    btn.disabled = true // 先禁，防连击；失败再恢复
    try {
      const resp = (await chrome.runtime.sendMessage({
        kind: 'saveWord',
        word,
        context: this.currentCueText ?? undefined,
        translation: this.cardTranslation,
        pageUrl: location.href,
        pageTitle: document.title,
      })) as BgResponse<unknown>
      if (resp.ok) {
        btn.textContent = '已收藏'
      } else {
        btn.disabled = false
      }
    } catch {
      btn.disabled = false
    }
  }
}
