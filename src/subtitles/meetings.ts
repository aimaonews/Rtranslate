/**
 * @file src/subtitles/meetings.ts
 * 在线会议字幕翻译：Google Meet / Microsoft Teams / Zoom Web Client。
 * 方案（参考 fluentread platformRuntime，按 Rtranslate 契约简化）：会议字幕没有可下载的
 * 字幕文件，只能 MutationObserver 监听 DOM；取最近 3 条 → 签名去重（文本 hash + 失败
 * 时间窗口）→ translateText（并发 2，失败静默跳过）→ Shadow DOM 双语面板（右下角
 * fixed，避开原生字幕区）；原生字幕容器 visibility:hidden（保留布局，退出时恢复）。
 * 已知风险：Meet/Zoom 字幕类名是构建混淆名，随版本滚动可能改名，故选择器全部集中在
 * PLATFORM_SPECS 一张表，稳定属性（data-caption-text / data-tid）优先、混淆类名兜底。
 */
import { getSubtitlesConfig, translateText } from './types'
import { normalizeConfig, type Config } from '../shared/config'

// ==================== 常量 ====================

const MAX_CUES = 3 // 面板保留 / 参与翻译的最新字幕条数
const THROTTLE_MS = 250 // MutationObserver → sync 的节流间隔（尾部合并）
const URL_POLL_MS = 1000 // URL 轮询间隔（SPA 的 pushState 不触发 popstate）
const DEDUP_WINDOW_MS = 60_000 // 同一条字幕翻译失败后的静默窗口：窗口内不重试
const TRANSLATE_CONCURRENCY = 2 // 翻译并发上限
const MAX_TEXT_LEN = 500 // 单条字幕截断长度（防异常长文本打爆翻译请求）
const CACHE_MAX = 200 // 会话级翻译缓存上限（超出按插入顺序淘汰最旧）
const PANEL_Z_INDEX = 999999 // 压过会议控制条，但不用 max int32 以免干扰平台弹窗

// ==================== 平台适配表 ====================

type MeetingPlatformId = 'meet' | 'teams' | 'zoom'

interface PlatformSpec {
  readonly id: MeetingPlatformId
  /** 域名 + 路径匹配：当前页面是否属于该平台 */
  readonly match: (host: string, pathname: string) => boolean
  /** 是否"在会议中"：SPA 首页不常驻 observer；URL 变化离开会议时据此停止并清理 */
  readonly inMeeting: (pathname: string) => boolean
  /** 原生字幕容器选择器（visibility:hidden 用）。数组即 fallback 链，混淆类名改名后靠后的稳定选择器兜底 */
  readonly containers: readonly string[]
  /** 单条字幕节点选择器（取 textContent），同样按稳定性排序 */
  readonly items: readonly string[]
  /** "开启字幕"按钮候选选择器（面板提示用户一键开启原生字幕） */
  readonly enableButtons: readonly string[]
}

/** 只匹配明确的"开启/显示字幕"，不匹配"关闭字幕"、录制或转录按钮 */
const CAPTION_ENABLE_LABEL =
  /^(?:turn on (?:live )?captions|show (?:closed |live )?(?:captions|subtitles)|开启(?:实时)?字幕|打开(?:实时)?字幕|显示(?:实时)?字幕)(?:\s*\([^)]*\))?$/i

const PLATFORM_SPECS: readonly PlatformSpec[] = [
  {
    id: 'meet',
    match: (host) => host === 'meet.google.com',
    // Meet 会议 URL 形如 /abc-defg-hij（3-4-3 小写字母）；首页 / 与 /new 不算在会议中
    inMeeting: (pathname) => /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\/|$)/i.test(pathname),
    // 风险：.a4cQT/.ygicle.VbkSUe/.CNuske 均为 Google 混淆类名，随版本滚动可能改名；
    // [data-caption-text] 是功能属性、相对稳定。选择器失效先改这里。
    containers: ['.a4cQT', '.ygicle.VbkSUe', '[data-caption-text]'],
    items: ['[data-caption-text]', '.CNuske'],
    enableButtons: ['button[aria-label]', '[role="button"][aria-label]'],
  },
  {
    id: 'teams',
    match: (host) =>
      host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft',
    // Teams 会议 URL 形态多变（/v2/、/l/meetup-join/ 等），不额外限制：无字幕节点时 sync 空转
    inMeeting: () => true,
    // data-tid 是 Teams 稳定测试 id，最可靠；.fui-ChatMessage__caption 是 Fluent UI 类名，可能变
    containers: ['[data-tid="closed-caption-text"]', '.fui-ChatMessage__caption'],
    items: ['[data-tid="closed-caption-text"]', '.fui-ChatMessage__caption'],
    enableButtons: [
      '[data-tid="toggle-captions"]',
      '[data-tid="closed-caption-button"]',
      '[data-tid="turn-on-live-captions"]',
    ],
  },
  {
    id: 'zoom',
    // Zoom Web Client 路径以 /wc 开头（zoom.us / zoom.com 及子域）
    match: (host, pathname) => /(^|\.)zoom\.(us|com)$/.test(host) && /^\/wc(?:\/|$)/.test(pathname),
    inMeeting: () => true,
    // live-transcription-subtitle__* 是 Zoom 组件语义类名，相对稳定但仍可能调整
    containers: ['.live-transcription-subtitle__item'],
    items: ['.live-transcription-subtitle__item'],
    enableButtons: ['.footer__cc-button', 'button[aria-label]'],
  },
]

// ==================== 工具函数 ====================

function detectPlatform(host: string, pathname: string): PlatformSpec | null {
  for (const spec of PLATFORM_SPECS) {
    if (spec.match(host, pathname)) return spec
  }
  return null
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN)
}

/** djb2：字幕签名去重用的轻量 hash（不需要密码学强度） */
function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

interface Cue {
  hash: string
  text: string
}

/** 有限并发执行器：最多 limit 个任务同时在途，全部完成才 settle */
async function mapLimit(items: readonly Cue[], limit: number, fn: (item: Cue) => Promise<void>): Promise<void> {
  let index = 0
  const worker = async (): Promise<void> => {
    while (index < items.length) await fn(items[index++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Shadow DOM 面板样式（原文小字 + 译文大字；host 上 pointer-events:none，仅按钮可点） */
const PANEL_CSS = `
:host([hidden]){display:none!important}
*{box-sizing:border-box;margin:0;padding:0}
.panel{display:flex;flex-direction:column;gap:8px;max-width:min(440px,38vw);max-height:42vh;overflow:hidden;
  padding:10px 14px;border-radius:10px;background:rgba(17,24,32,.78);color:#fff;text-align:left;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  box-shadow:0 4px 18px rgba(0,0,0,.35)}
.cues{display:flex;flex-direction:column;gap:8px}
.cue{display:flex;flex-direction:column;gap:2px;border-left:3px solid rgba(255,255,255,.28);padding-left:8px}
.src{font-size:12px;line-height:1.35;opacity:.72;white-space:pre-wrap;overflow-wrap:anywhere}
.dst{font-size:17px;font-weight:600;line-height:1.4;color:#ffe08a;white-space:pre-wrap;overflow-wrap:anywhere}
.dst.pending{opacity:.55;font-weight:400}
[hidden]{display:none!important}
.enable{pointer-events:auto;cursor:pointer;align-self:flex-start;font:13px/1.4 system-ui,sans-serif;
  color:#0b1520;background:#ffe08a;border:none;border-radius:6px;padding:6px 12px}
.enable:hover{background:#ffcf4d}
.enable:focus-visible{outline:2px solid #fff;outline-offset:1px}
`

// ==================== 会议会话 ====================

/**
 * 一个会议平台页面的运行时会话：字幕捕获、翻译调度、面板渲染与清理。
 * 配置关闭（热开关）时 dispose 完整还原现场；URL 变化离开会议时
 * stopRuntime 停止 observer 并清理面板，回到会议时重新启动。
 */
class MeetingSession {
  private config: Config
  private readonly platform: PlatformSpec
  private observer: MutationObserver | null = null
  private throttleTimer: ReturnType<typeof setTimeout> | undefined
  private urlTimer: ReturnType<typeof setInterval> | undefined
  private lastUrl = location.href
  private disposed = false
  /** 递增使过期异步翻译结果失效（防竞态：重置/清理后在途回调直接丢弃） */
  private generation = 0
  private host: HTMLElement | null = null
  private cueListEl: HTMLElement | null = null
  private enableBtnEl: HTMLButtonElement | null = null
  /** 被我们隐藏的原生字幕容器 → 原 inline visibility（退出时恢复布局） */
  private readonly hiddenNodes = new Map<HTMLElement, { value: string; priority: string }>()
  /** 文本 hash → 译文（会话级缓存：同一条字幕绝不重复翻译） */
  private readonly cache = new Map<string, string>()
  /** 文本 hash → 失败时间戳（时间窗口内不重试；窗口外允许再试一次） */
  private readonly failed = new Map<string, number>()
  private readonly inflight = new Set<string>()
  private lastSignature = ''
  private cues: Cue[] = []

  constructor(platform: PlatformSpec, config: Config) {
    this.platform = platform
    this.config = config
  }

  start(): void {
    this.urlTimer = setInterval(() => {
      this.checkUrl()
      this.scheduleSync() // 安全兜底：observer 理论上全覆盖，低频补一次 sync 防漏
    }, URL_POLL_MS)
    window.addEventListener('popstate', this.onNav)
    window.addEventListener('hashchange', this.onNav)
    document.addEventListener('fullscreenchange', this.onFullscreen)
    if (this.platform.inMeeting(location.pathname)) this.startRuntime()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopRuntime()
    if (this.urlTimer !== undefined) clearInterval(this.urlTimer)
    this.urlTimer = undefined
    window.removeEventListener('popstate', this.onNav)
    window.removeEventListener('hashchange', this.onNav)
    document.removeEventListener('fullscreenchange', this.onFullscreen)
  }

  /** 配置热更新：目标语言变化时清缓存强制重译 */
  updateConfig(config: Config): void {
    const langChanged = config.general.targetLang !== this.config.general.targetLang
    this.config = config
    if (langChanged) {
      this.cache.clear()
      this.failed.clear()
      this.lastSignature = ''
    }
    this.scheduleSync()
  }

  private readonly onNav = (): void => this.checkUrl()

  private readonly onFullscreen = (): void => {
    // 全屏时 fixed 元素只有在 fullscreenElement 子树内才可见，重新挂载
    if (!this.host) return
    const parent = document.fullscreenElement || document.body
    if (parent && this.host.parentElement !== parent) parent.appendChild(this.host)
  }

  private startRuntime(): void {
    if (this.disposed || this.observer) return
    this.resetState()
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target
        // 忽略扩展自身节点引起的突变（面板挂在 body 下、Shadow DOM 内变化本就观测不到）
        if (target instanceof Element && target.closest('[data-tv-owned]')) continue
        this.scheduleSync()
        return
      }
    })
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true, // Meet 会在原地更新字幕文本节点
    })
    this.sync()
  }

  /** 停止 observer 并清理面板、恢复原生字幕（离开会议 / 配置关闭时调用） */
  private stopRuntime(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.throttleTimer !== undefined) clearTimeout(this.throttleTimer)
    this.throttleTimer = undefined
    this.resetState()
    this.restoreNative()
    this.host?.remove()
    this.host = null
    this.cueListEl = null
    this.enableBtnEl = null
  }

  private resetState(): void {
    this.generation++ // 使在途翻译回调失效
    this.cache.clear()
    this.failed.clear()
    this.inflight.clear()
    this.cues = []
    this.lastSignature = ''
  }

  /** SPA 路由变化检测：离开会议 → 停止 observer + 清理面板；换会议 → 重置；回会议 → 重启 */
  private checkUrl(): void {
    if (this.disposed || location.href === this.lastUrl) return
    this.lastUrl = location.href
    const inMeeting =
      this.platform.match(location.hostname, location.pathname) &&
      this.platform.inMeeting(location.pathname)
    if (!inMeeting) {
      this.stopRuntime()
    } else if (!this.observer) {
      this.startRuntime()
    } else {
      this.resetState()
      this.restoreNative()
      this.hidePanel()
      this.sync()
    }
  }

  /** 250ms 尾部节流：突变洪峰合并为一次 sync */
  private scheduleSync(): void {
    if (this.disposed || !this.observer || this.throttleTimer !== undefined) return
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = undefined
      this.sync()
    }, THROTTLE_MS)
  }

  private sync(): void {
    if (this.disposed || !this.observer) return
    this.pruneMaps()
    const { containers, texts } = this.collectCaptions()
    if (texts.length === 0) {
      // 无字幕：恢复原生容器（没什么可遮的），面板只保留"开启字幕"提示（如有）
      this.restoreNative()
      this.cues = []
      this.lastSignature = ''
      return this.renderPanel()
    }
    this.hideNative(containers)
    this.cues = texts.map((text) => ({ hash: hashText(text), text }))
    const signature = this.config.general.targetLang + '|' + this.cues.map((c) => c.hash).join(',')
    if (signature === this.lastSignature) return // 签名未变：不重译、不重排
    this.lastSignature = signature
    this.renderPanel() // 先上原文（缓存命中者直接带译文）
    void this.translatePending()
  }

  /** 收集原生字幕：容器（隐藏用）+ 最近 MAX_CUES 条文本；剔除嵌套重复与不可见节点 */
  private collectCaptions(): { containers: HTMLElement[]; texts: string[] } {
    const containers = Array.from(
      document.querySelectorAll<HTMLElement>(this.platform.containers.join(',')),
    ).filter((el) => !el.closest('[data-tv-owned]'))
    const allItems = Array.from(
      document.querySelectorAll<HTMLElement>(this.platform.items.join(',')),
    ).filter(
      (el) =>
        !el.closest('[data-tv-owned], [hidden], [aria-hidden="true"]') &&
        (el.textContent || '').trim().length > 0,
    )
    // 外层与内层同时命中选择器时只保留内层（如 .CNuske 包着 [data-caption-text]）
    const items = allItems.filter((el) => !allItems.some((o) => o !== el && el.contains(o)))
    const texts = items
      .map((el) => normalizeText(el.textContent || ''))
      .filter((text) => text.length > 0)
      .slice(-MAX_CUES)
    return { containers, texts }
  }

  /** 原生字幕容器 visibility:hidden（保留布局）；记录原值以便恢复 */
  private hideNative(nodes: HTMLElement[]): void {
    for (const node of nodes) {
      if (!this.hiddenNodes.has(node)) {
        this.hiddenNodes.set(node, {
          value: node.style.getPropertyValue('visibility'),
          priority: node.style.getPropertyPriority('visibility'),
        })
      }
      node.style.setProperty('visibility', 'hidden', 'important')
    }
    for (const node of Array.from(this.hiddenNodes.keys())) {
      if (!node.isConnected) this.hiddenNodes.delete(node)
    }
  }

  private restoreNative(): void {
    for (const [node, prev] of this.hiddenNodes) {
      const s = node.style
      if (s.getPropertyValue('visibility') === 'hidden' && s.getPropertyPriority('visibility') === 'important') {
        if (prev.value) s.setProperty('visibility', prev.value, prev.priority)
        else s.removeProperty('visibility')
      }
    }
    this.hiddenNodes.clear()
  }

  private pruneMaps(): void {
    const now = Date.now()
    for (const [hash, at] of this.failed) {
      if (now - at > DEDUP_WINDOW_MS) this.failed.delete(hash)
    }
    if (this.cache.size <= CACHE_MAX) return
    let excess = this.cache.size - CACHE_MAX
    for (const key of this.cache.keys()) {
      this.cache.delete(key)
      if (--excess <= 0) break
    }
  }

  /** 翻译未命中缓存的字幕：并发 2；失败静默跳过该条（记时间戳，窗口内不重试，下一条不受影响） */
  private async translatePending(): Promise<void> {
    const gen = this.generation
    const now = Date.now()
    const pending = this.cues.filter(
      (cue) =>
        !this.cache.has(cue.hash) &&
        !this.inflight.has(cue.hash) &&
        !(this.failed.has(cue.hash) && now - this.failed.get(cue.hash)! < DEDUP_WINDOW_MS),
    )
    if (pending.length === 0) return this.renderPanel()
    for (const cue of pending) this.inflight.add(cue.hash)
    this.renderPanel() // 显示 pending 占位
    await mapLimit(pending, TRANSLATE_CONCURRENCY, async (cue) => {
      try {
        this.cache.set(cue.hash, await translateText(cue.text, this.config.general.targetLang))
      } catch {
        this.failed.set(cue.hash, Date.now()) // 静默跳过该条，下一条继续
      } finally {
        this.inflight.delete(cue.hash)
      }
      if (!this.disposed && gen === this.generation) this.renderPanel()
    })
  }

  /** 找原生"开启字幕"按钮：存在且未按下时，面板提示用户一键开启 */
  private findEnableButton(): HTMLElement | null {
    const candidates = document.querySelectorAll<HTMLElement>(this.platform.enableButtons.join(','))
    for (const btn of Array.from(candidates)) {
      if (btn.closest('[data-tv-owned], [hidden], [aria-hidden="true"]')) continue
      if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') continue
      if (btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-checked') === 'true') continue
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim()
      if (CAPTION_ENABLE_LABEL.test(label)) return btn
    }
    return null
  }

  private ensurePanel(): boolean {
    const parent = document.fullscreenElement || document.body
    if (!parent) return false
    if (this.host) {
      if (this.host.parentElement !== parent) parent.appendChild(this.host)
      return true
    }
    const host = document.createElement('div')
    host.setAttribute('data-tv-owned', '1')
    host.setAttribute('translate', 'no')
    host.className = 'notranslate'
    host.style.cssText = `all:initial!important;position:fixed!important;right:16px!important;bottom:88px!important;z-index:${PANEL_Z_INDEX}!important;pointer-events:none!important;`
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', '会议字幕翻译 Meeting captions')
    const enableBtn = document.createElement('button')
    enableBtn.type = 'button'
    enableBtn.className = 'enable'
    enableBtn.textContent = '点击开启字幕翻译 (Turn on captions)'
    enableBtn.hidden = true
    enableBtn.addEventListener('click', () => {
      // 代用户点一次原生"开启字幕"按钮；字幕流出后提示自动消失
      this.findEnableButton()?.click()
      this.renderPanel()
    })
    const cueList = document.createElement('div')
    cueList.className = 'cues'
    panel.append(enableBtn, cueList)
    shadow.append(style, panel)
    parent.appendChild(host)
    this.host = host
    this.cueListEl = cueList
    this.enableBtnEl = enableBtn
    return true
  }

  /** 重建面板内容（最多 3 条，全量重绘成本可忽略；一律 textContent，规避 TT/CSP） */
  private renderPanel(): void {
    if (this.disposed) return
    const enableCandidate = this.cues.length === 0 ? this.findEnableButton() : null
    if (this.cues.length === 0 && !enableCandidate) return this.hidePanel()
    if (!this.ensurePanel()) return
    const host = this.host as HTMLElement
    const cueList = this.cueListEl as HTMLElement
    const enableBtn = this.enableBtnEl as HTMLButtonElement
    enableBtn.hidden = !enableCandidate
    cueList.textContent = ''
    for (const cue of this.cues) {
      const wrap = document.createElement('div')
      wrap.className = 'cue'
      const src = document.createElement('div')
      src.className = 'src'
      src.textContent = cue.text
      const dst = document.createElement('div')
      dst.className = 'dst'
      const translation = this.cache.get(cue.hash)
      if (translation) dst.textContent = translation
      else if (this.inflight.has(cue.hash)) {
        dst.textContent = '…'
        dst.classList.add('pending')
      } else dst.hidden = true // 失败或等待调度：静默（只显示原文）
      wrap.append(src, dst)
      cueList.appendChild(wrap)
    }
    if (host.hidden) host.hidden = false
  }

  private hidePanel(): void {
    if (this.host && !this.host.hidden) this.host.hidden = true
  }
}

// ==================== 入口 ====================

let booted = false

/**
 * 会议字幕翻译入口（content 引导调用一次，重复调用幂等）。
 * config.subtitles.enabled && config.subtitles.meet 未同时开启时不启动任何
 * observer / 面板（直接返回）；storage.onChanged 热开关：开启即启动、关闭即停止并还原现场。
 */
export function startMeetings(): void {
  if (booted) return
  booted = true
  const platform = detectPlatform(location.hostname, location.pathname)
  if (!platform) return
  let session: MeetingSession | null = null
  const apply = (config: Config | null): void => {
    const enabled = !!config && config.subtitles.enabled && config.subtitles.meet
    if (!enabled) {
      session?.dispose()
      session = null
      return
    }
    if (session) session.updateConfig(config)
    else {
      session = new MeetingSession(platform, config)
      session.start()
    }
  }
  void getSubtitlesConfig().then(apply)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['tv:config_v1']) return
    apply(normalizeConfig(changes['tv:config_v1'].newValue))
  })
}
