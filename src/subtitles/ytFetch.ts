// YouTube 字幕获取：MAIN world 注入桥 + postMessage 客户端 + timedtext 解析
// 策略（read-frog）：快路径 = 内容脚本直接 fetch(baseUrl + '&fmt=json3')；
// 失败降级 = MAIN world 捕获的带 pot token 的 timedtext URL（必要时先点开 CC 触发请求）。
import type { SubtitleCue } from './types'

export interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind?: string // 'asr' = 自动生成
  vssId?: string
  name?: string
}

export interface PlayerData {
  videoId: string
  captionTracks: CaptionTrack[]
  cachedTimedtextUrl: string | null
}

// ===== postMessage 协议 =====

const REQ_TYPE = 'tv-yt-bridge-request'
const RES_TYPE = 'tv-yt-bridge-response'
const DEFAULT_TIMEOUT_MS = 4000
const WAIT_TIMEDTEXT_TIMEOUT_MS = 8000

type BridgeAction = 'playerData' | 'waitTimedtext' | 'ensureCc'

interface BridgeResponse {
  type: typeof RES_TYPE
  requestId: string
  ok: boolean
  // playerData
  videoId?: string
  captionTracks?: CaptionTrack[]
  cachedTimedtextUrl?: string | null
  // waitTimedtext
  url?: string | null
  error?: string
}

// ===== MAIN world 桥（序列化注入，必须自包含、不引用模块作用域） =====

// 注意：此函数会被 toString() 序列化后注入 MAIN world 执行，
// 必须完全自包含 —— 禁止引用任何模块作用域变量/常量/导入。
function mainWorldBridge(): void {
  const w = window as unknown as Record<string, unknown>
  if (w.__tvYtBridgeInjected__) return
  w.__tvYtBridgeInjected__ = true

  const REQ = 'tv-yt-bridge-request'
  const RES = 'tv-yt-bridge-response'

  interface YtPlayer extends HTMLElement {
    getPlayerResponse?: () => unknown
    toggleSubtitles?: () => void
  }

  // --- timedtext URL 捕获（带 pot token 的完整 URL，按 videoId 缓存） ---
  const urlCache = new Map<string, string>()
  const urlWaiters = new Map<string, Array<(url: string) => void>>()

  function cacheTimedtextUrl(rawUrl: string): void {
    try {
      if (!rawUrl || rawUrl.indexOf('api/timedtext') === -1) return
      const u = new URL(rawUrl)
      const vid = u.searchParams.get('v')
      if (!vid || !u.searchParams.get('pot')) return
      urlCache.set(vid, rawUrl)
      const waiters = urlWaiters.get(vid)
      if (waiters) {
        urlWaiters.delete(vid)
        for (const resolve of waiters) resolve(rawUrl)
      }
    } catch {
      /* ignore */
    }
  }

  function waitForUrl(vid: string, timeoutMs: number): Promise<string | null> {
    const cached = urlCache.get(vid)
    if (cached) return Promise.resolve(cached)
    return new Promise((resolve) => {
      const list = urlWaiters.get(vid) ?? []
      const entry = (url: string): void => resolve(url)
      list.push(entry)
      urlWaiters.set(vid, list)
      setTimeout(() => {
        const cur = urlWaiters.get(vid)
        if (cur) {
          const i = cur.indexOf(entry)
          if (i !== -1) cur.splice(i, 1)
          if (cur.length === 0) urlWaiters.delete(vid)
        }
        resolve(urlCache.get(vid) ?? null)
      }, timeoutMs)
    })
  }

  // hook XHR
  type Variadic = (this: XMLHttpRequest, ...args: unknown[]) => void
  const origOpen = XMLHttpRequest.prototype.open as unknown as Variadic
  const origSend = XMLHttpRequest.prototype.send as unknown as Variadic
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    ;(this as unknown as { __tvUrl?: string }).__tvUrl = String(args[1])
    origOpen.apply(this, args)
  } as unknown as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]): void {
    this.addEventListener('load', function (this: XMLHttpRequest) {
      const self = this as unknown as { __tvUrl?: string; responseURL: string }
      cacheTimedtextUrl(self.responseURL || self.__tvUrl || '')
    })
    origSend.apply(this, args)
  } as unknown as typeof XMLHttpRequest.prototype.send

  // hook fetch（新版播放器可能走 fetch）
  const origFetch = window.fetch
  window.fetch = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url && url.indexOf('api/timedtext') !== -1) cacheTimedtextUrl(url)
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line prefer-rest-params
    return origFetch.apply(this, arguments as unknown as [RequestInfo | URL])
  } as typeof window.fetch

  function findPlayer(): YtPlayer | null {
    const el = document.querySelector<YtPlayer>('#movie_player')
    if (el) return el
    return document.querySelector<YtPlayer>('.html5-video-player')
  }

  interface RawTrack {
    baseUrl?: string
    languageCode?: string
    kind?: string
    vssId?: string
    name?: { simpleText?: string }
  }

  function getPlayerData(expectedVideoId: string): {
    ok: boolean
    videoId?: string
    captionTracks?: CaptionTrack[]
    cachedTimedtextUrl?: string | null
    error?: string
  } {
    const player = findPlayer()
    if (!player || typeof player.getPlayerResponse !== 'function') {
      return { ok: false, error: 'PLAYER_NOT_FOUND' }
    }
    const resp = player.getPlayerResponse() as {
      videoDetails?: { videoId?: string }
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] } }
    } | null
    const videoId = resp?.videoDetails?.videoId
    if (!videoId || videoId !== expectedVideoId) {
      return { ok: false, error: 'VIDEO_ID_MISMATCH' }
    }
    const raw = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const captionTracks: CaptionTrack[] = raw
      .filter((t): t is RawTrack & { baseUrl: string } => typeof t?.baseUrl === 'string')
      .map((t) => ({
        baseUrl: t.baseUrl,
        languageCode: typeof t.languageCode === 'string' ? t.languageCode : '',
        ...(t.kind ? { kind: t.kind } : {}),
        ...(t.vssId ? { vssId: t.vssId } : {}),
        ...(t.name?.simpleText ? { name: t.name.simpleText } : {}),
      }))
    return {
      ok: true,
      videoId,
      captionTracks,
      cachedTimedtextUrl: urlCache.get(videoId) ?? null,
    }
  }

  function ensureCc(): void {
    const player = findPlayer()
    const btn = document.querySelector('.ytp-subtitles-button')
    const pressed = btn?.getAttribute('aria-pressed') === 'true'
    if (pressed) return
    if (player && typeof player.toggleSubtitles === 'function') {
      player.toggleSubtitles()
    } else if (btn instanceof HTMLElement) {
      btn.click()
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as {
      type?: string
      requestId?: string
      action?: BridgeAction
      videoId?: string
      timeoutMs?: number
    } | null
    if (!data || data.type !== REQ || typeof data.requestId !== 'string') return

    const reply = (payload: Record<string, unknown>): void => {
      window.postMessage({ type: RES, requestId: data.requestId, ...payload }, location.origin)
    }

    if (data.action === 'playerData' && typeof data.videoId === 'string') {
      try {
        reply(getPlayerData(data.videoId))
      } catch (e) {
        reply({ ok: false, error: String(e) })
      }
    } else if (data.action === 'waitTimedtext' && typeof data.videoId === 'string') {
      void waitForUrl(data.videoId, data.timeoutMs ?? 8000).then((url) => {
        reply({ ok: true, url })
      })
    } else if (data.action === 'ensureCc') {
      try {
        ensureCc()
      } catch {
        /* ignore */
      }
      reply({ ok: true })
    }
  })
}

// ===== 内容脚本侧：注入 + 请求客户端 =====

let bridgeInjected = false
let requestCounter = 0
const pendingRequests = new Map<
  string,
  { resolve: (resp: BridgeResponse) => void; timer: number }
>()

function ensureBridgeInjected(): void {
  if (bridgeInjected) return
  bridgeInjected = true

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as BridgeResponse | null
    if (!data || data.type !== RES_TYPE || typeof data.requestId !== 'string') return
    const pending = pendingRequests.get(data.requestId)
    if (!pending) return
    pendingRequests.delete(data.requestId)
    window.clearTimeout(pending.timer)
    pending.resolve(data)
  })

  const script = document.createElement('script')
  script.id = 'tv-yt-bridge'
  script.textContent = `(${mainWorldBridge.toString()})()`
  ;(document.head ?? document.documentElement).appendChild(script)
  script.remove()
}

function sendBridgeRequest(
  action: BridgeAction,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<BridgeResponse | null> {
  ensureBridgeInjected()
  return new Promise((resolve) => {
    const requestId = `tv-${Date.now()}-${++requestCounter}`
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId)
      resolve(null) // 桥未注入成功（如 CSP 拦截）或超时：走降级路径
    }, timeoutMs)
    pendingRequests.set(requestId, { resolve, timer })
    window.postMessage({ type: REQ_TYPE, requestId, action, ...payload }, location.origin)
  })
}

// ===== ytInitialPlayerResponse 降级（桥被 CSP 拦截时仍可读 DOM script 标签） =====

function parseInitialPlayerResponse(videoId: string): PlayerData | null {
  const scripts = document.querySelectorAll('script')
  for (const script of Array.from(scripts)) {
    const text = script.textContent
    if (!text || !text.includes('ytInitialPlayerResponse') || !text.includes('captionTracks')) {
      continue
    }
    const startIdx = text.indexOf('ytInitialPlayerResponse')
    const braceStart = text.indexOf('{', startIdx)
    if (braceStart === -1) continue
    // 花括号配对提取 JSON
    let depth = 0
    let end = -1
    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) continue
    try {
      const data = JSON.parse(text.slice(braceStart, end + 1)) as {
        videoDetails?: { videoId?: string }
        captions?: {
          playerCaptionsTracklistRenderer?: { captionTracks?: Array<Record<string, unknown>> }
        }
      }
      if (data?.videoDetails?.videoId !== videoId) continue
      const raw = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
      const captionTracks: CaptionTrack[] = raw
        .filter((t) => typeof t?.baseUrl === 'string')
        .map((t) => ({
          baseUrl: t.baseUrl as string,
          languageCode: typeof t.languageCode === 'string' ? t.languageCode : '',
          ...(typeof t.kind === 'string' ? { kind: t.kind } : {}),
          ...(typeof t.vssId === 'string' ? { vssId: t.vssId } : {}),
        }))
      return { videoId, captionTracks, cachedTimedtextUrl: null }
    } catch {
      continue
    }
  }
  return null
}

async function getPlayerData(videoId: string): Promise<PlayerData | null> {
  const resp = await sendBridgeRequest('playerData', { videoId }, DEFAULT_TIMEOUT_MS)
  if (resp?.ok && resp.videoId === videoId && Array.isArray(resp.captionTracks)) {
    return {
      videoId,
      captionTracks: resp.captionTracks,
      cachedTimedtextUrl: resp.cachedTimedtextUrl ?? null,
    }
  }
  return parseInitialPlayerResponse(videoId)
}

// ===== 轨道选择 =====

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  // 优先人工字幕（无 kind=asr），否则第一条
  return tracks.find((t) => t.kind !== 'asr') ?? tracks[0] ?? null
}

// ===== timedtext 下载 =====

async function fetchText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { credentials: 'include' })
    if (!resp.ok) return null
    const text = await resp.text()
    return text.trim() ? text : null
  } catch {
    return null
  }
}

function forceJson3(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('fmt', 'json3')
    return u.toString()
  } catch {
    return url
  }
}

// ===== 解析：json3 / XML → 统一事件 → SubtitleCue[] =====

interface TimedEvent {
  tStartMs: number
  dDurationMs: number
  aAppend?: number
  wWinId?: number
  segs: Array<{ utf8: string; tOffsetMs?: number }>
}

function parseTimedText(text: string): TimedEvent[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) return parseJson3(trimmed)
  return parseXml(trimmed)
}

function parseJson3(text: string): TimedEvent[] | null {
  try {
    const data = JSON.parse(text) as { events?: TimedEvent[] }
    if (!Array.isArray(data.events)) return null
    return data.events.filter((e) => e && Number.isFinite(e.tStartMs))
  } catch {
    return null
  }
}

function parseXml(text: string): TimedEvent[] | null {
  try {
    const xml = new DOMParser().parseFromString(text, 'text/xml')
    if (xml.querySelector('parsererror')) return null
    // srv1: transcript > text[start(秒) dur(秒)]；srv3: timedtext > body > p[t(ms) d(ms)]
    const nodes = Array.from(xml.querySelectorAll('transcript > text, timedtext > body > p'))
    const events: TimedEvent[] = nodes.map((node) => {
      const srv3 = node.tagName === 'p'
      const start = Number(node.getAttribute(srv3 ? 't' : 'start')) * (srv3 ? 1 : 1000)
      const dur = Number(node.getAttribute(srv3 ? 'd' : 'dur')) * (srv3 ? 1 : 1000)
      return {
        tStartMs: Number.isFinite(start) ? start : 0,
        dDurationMs: Number.isFinite(dur) ? dur : 0,
        segs: [{ utf8: node.textContent ?? '' }],
      }
    })
    return events.length ? events : null
  } catch {
    return null
  }
}

// ===== 事件 → Cue：标准轨与滚动 ASR 轨 =====

const SENTENCE_END = /[.!?。！？…]["'”’)\]]?\s*$/
const ASR_MAX_CHARS = 100
const ASR_GAP_MS = 800

function cleanText(s: string): string {
  return s.replace(/​/g, '').replace(/\s+/g, ' ').trim()
}

function isScrollingAsr(events: TimedEvent[]): boolean {
  return events.some((e) => e.wWinId !== undefined || e.aAppend === 1)
}

/** 标准轨：一个事件一条 cue */
function eventsToCuesStandard(events: TimedEvent[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const e of events) {
    const text = cleanText((e.segs ?? []).map((s) => s.utf8).join(''))
    if (!text) continue
    const start = e.tStartMs / 1000
    const end = (e.tStartMs + (e.dDurationMs || 2000)) / 1000
    const last = cues[cues.length - 1]
    if (last && last.end > start) last.end = start // 防重叠
    cues.push({ start, end, text })
  }
  return cues
}

/** 滚动 ASR：跨事件累积词片段，按句末标点/长度/时间间隙断句 */
function eventsToCuesAsr(events: TimedEvent[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let buf = ''
  let bufStart = 0
  let bufEnd = 0
  let pendingSplit = false

  const flush = (): void => {
    const text = cleanText(buf)
    if (text) {
      const start = bufStart / 1000
      let end = bufEnd / 1000
      if (end <= start) end = start + 2
      const last = cues[cues.length - 1]
      if (last && last.end > start) last.end = start
      cues.push({ start, end, text })
    }
    buf = ''
    pendingSplit = false
  }

  let prevEventEnd = 0
  for (const e of events) {
    // aAppend=1 是滚动窗口的分隔事件：只用于触发断句与校准结束时间
    if (e.aAppend === 1) {
      if (buf) {
        bufEnd = Math.max(bufEnd, e.tStartMs + (e.dDurationMs || 0))
        if (pendingSplit) flush()
      }
      continue
    }
    if (!e.segs || e.segs.length === 0) continue

    // 大间隙且已积满一句 → 先落盘
    if (buf && pendingSplit && e.tStartMs - prevEventEnd > ASR_GAP_MS) flush()

    for (let i = 0; i < e.segs.length; i++) {
      const seg = e.segs[i]
      const segText = seg?.utf8 ?? ''
      if (!segText) continue
      // 上一句已满（句末标点/长度上限）：在追加新词前落盘
      if (buf && pendingSplit) flush()
      if (!buf.trim()) bufStart = e.tStartMs + (seg.tOffsetMs ?? 0)
      buf += segText
      const nextOffset = e.segs[i + 1]?.tOffsetMs
      bufEnd =
        nextOffset !== undefined
          ? Math.max(e.tStartMs + nextOffset, bufEnd)
          : Math.max(e.tStartMs + (e.dDurationMs || 0), e.tStartMs + (seg.tOffsetMs ?? 0) + 200)
      const trimmed = segText.trim()
      if (SENTENCE_END.test(trimmed) || cleanText(buf).length >= ASR_MAX_CHARS) {
        pendingSplit = true
      }
    }
    prevEventEnd = e.tStartMs + (e.dDurationMs || 0)
    if (buf && pendingSplit) flush()
  }
  flush()
  return cues
}

// ===== 对外主入口 =====

/**
 * 拉取指定视频的字幕轨并解析为 SubtitleCue[]。
 * 无字幕轨 / 全部路径失败时返回 null（调用方静默退出）。
 */
export async function fetchYouTubeCues(videoId: string): Promise<SubtitleCue[] | null> {
  const playerData = await getPlayerData(videoId)
  if (!playerData || playerData.captionTracks.length === 0) return null

  const track = pickTrack(playerData.captionTracks)
  if (!track) return null

  // 快路径：内容脚本直接 fetch baseUrl + fmt=json3
  const directUrl = forceJson3(track.baseUrl)
  let text = await fetchText(directUrl)
  let cues = text ? tryParse(text, track) : null
  if (cues && cues.length > 0) return cues

  // 降级 1：MAIN world 已捕获的带 pot 的 timedtext URL
  let potUrl = playerData.cachedTimedtextUrl

  // 降级 2：让播放器打开 CC 触发一次字幕请求，然后等捕获
  if (!potUrl) {
    void sendBridgeRequest('ensureCc', {}, DEFAULT_TIMEOUT_MS)
    const resp = await sendBridgeRequest(
      'waitTimedtext',
      { videoId, timeoutMs: WAIT_TIMEDTEXT_TIMEOUT_MS },
      WAIT_TIMEDTEXT_TIMEOUT_MS + 1000,
    )
    potUrl = resp?.url ?? null
  }

  if (!potUrl) return null
  text = await fetchText(forceJson3(potUrl))
  cues = text ? tryParse(text, track) : null
  return cues && cues.length > 0 ? cues : null
}

function tryParse(text: string, track: CaptionTrack): SubtitleCue[] | null {
  const events = parseTimedText(text)
  if (!events) return null
  const asr = track.kind === 'asr' || isScrollingAsr(events)
  const cues = asr ? eventsToCuesAsr(events) : eventsToCuesStandard(events)
  return cues.length > 0 ? cues : null
}
