// 内容脚本入口：配置装载与热同步、快捷键、消息监听、各子系统装配。
import { PageTranslator } from './page'
import { initSelection, setSelectionConfig } from './selection'
import { initHover, setHoverConfig } from './hover'
import { initInput, setInputConfig } from './input'
import { toggleFloatingBall, updateBallState } from './floatingBall'
import { initCompareWindow } from './compareWindow'
import { applyHighlights } from './highlight'
import { detectPageLang } from '../core/detect'
import { DEFAULT_CONFIG, normalizeConfig, type Config } from '../shared/config'
import type { BgRequest, BgResponse, ContentRequest, PageStateResult } from '../shared/protocol'
import { setContentUiLang } from './uiLang'

const w = window as unknown as { __TV_CONTENT_INJECTED__?: boolean }
if (!w.__TV_CONTENT_INJECTED__) {
  w.__TV_CONTENT_INJECTED__ = true
  void main()
}

let currentConfig: Config = DEFAULT_CONFIG
const pageTranslator = new PageTranslator(() => currentConfig)

/** 整页翻译状态 → 扩展图标角标（绿 ✓ = 开启）。失败静默（页面卸载中 / SW 未就绪等）。 */
function reportBadge(active: boolean) {
  const req: BgRequest = { kind: 'setBadge', active }
  void chrome.runtime.sendMessage(req).catch(() => {})
}

/**
 * pageTranslator.toggle() 唯一入口：悬浮球 / 快捷键 / popup 命令 / 自动翻译全部走这里，
 * 状态变化后同步悬浮球与扩展图标角标。返回切换后状态。
 */
async function togglePageTranslation(): Promise<boolean> {
  const active = await pageTranslator.toggle()
  updateBallState(active)
  reportBadge(active)
  return active
}

async function main() {
  try {
    const resp = (await chrome.runtime.sendMessage({ kind: 'getConfig' })) as BgResponse<Config>
    currentConfig = resp.ok ? resp.data : DEFAULT_CONFIG
  } catch {
    currentConfig = DEFAULT_CONFIG
  }
  applyConfig(currentConfig, true)
}

function applyConfig(config: Config, first = false) {
  currentConfig = config
  setContentUiLang(config)
  setSelectionConfig(config)
  setHoverConfig(config)
  setInputConfig(config)
  if (first) {
    initSelection(config)
    initHover(config)
    initInput(config)
    initCompareWindow()
    void maybeAutoTranslate()
  }
  // 悬浮球运行时开关（关闭即移除，开启即创建，无需刷新）
  toggleFloatingBall(config.floatingBall.enabled, {
    isActive: () => pageTranslator.isActive(),
    onToggle: () => void togglePageTranslation(),
  })
  if (config.learning.enabled && config.learning.highlightOnPage) void applyHighlights(true)
}

async function maybeAutoTranslate() {
  try {
    const host = location.hostname
    const match = (s: string) => host === s || host.endsWith('.' + s)
    if (currentConfig.general.neverTranslateSites.some(match)) return
    if (currentConfig.general.autoTranslateSites.some(match)) {
      await togglePageTranslation()
      return
    }
    if (currentConfig.general.autoTranslateLangs.length) {
      const pageLang = detectPageLang(document)
      if (pageLang && currentConfig.general.autoTranslateLangs.includes(pageLang)) {
        await togglePageTranslation()
      }
    }
  } catch {
    /* 自动翻译失败静默 */
  }
}

// ===== 快捷键匹配 =====
/** e.code → 规格主键名：KeyT→'T'、Digit1→'1'、Space/Enter/F5 等原样。 */
function codeToKeyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/** e.code 为修饰键本身时返回其名称，否则 null。 */
function modifierOfCode(code: string): 'alt' | 'ctrl' | 'shift' | 'meta' | null {
  if (code === 'AltLeft' || code === 'AltRight') return 'alt'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'shift'
  if (code === 'MetaLeft' || code === 'MetaRight') return 'meta'
  return null
}

/**
 * 匹配快捷键规格（如 'Alt+T'、'Ctrl+Shift+D'、'Alt'）。
 * - 空串 = 禁用，永不命中。
 * - 修饰键 Alt/Ctrl/Shift/Meta 必须与事件严格一致（多按少按都不命中）。
 * - 主键按 e.code 匹配：KeyT→'T'、Digit1→'1'、Space→'Space'，大小写不敏感。
 * - 仅修饰键规格（如 'Alt'）：只在按下该修饰键本身时命中，Alt+A 不命中。
 * - Mac 上 Meta 与 Ctrl 等价：规格写 Ctrl 时按 Cmd（metaKey）同样命中，反之亦然，
 *   避免同一份配置跨平台失效。
 */
export function matchHotkey(e: KeyboardEvent, spec: string): boolean {
  const parts = spec
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return false

  const want = { alt: false, ctrl: false, shift: false, meta: false }
  let mainKey = ''
  for (const part of parts) {
    const p = part.toLowerCase()
    if (p === 'alt') want.alt = true
    else if (p === 'ctrl' || p === 'control') want.ctrl = true
    else if (p === 'shift') want.shift = true
    else if (p === 'meta' || p === 'cmd' || p === 'command') want.meta = true
    else mainKey = part
  }

  // Mac 等价：Ctrl 与 Meta 任一声明即接受任一键按下
  const wantCtrlOrMeta = want.ctrl || want.meta
  const eventCtrlOrMeta = e.ctrlKey || e.metaKey
  if (e.altKey !== want.alt) return false
  if (eventCtrlOrMeta !== wantCtrlOrMeta) return false
  if (e.shiftKey !== want.shift) return false

  if (!mainKey) {
    // 仅修饰键规格：事件主键必须是已声明的修饰键本身
    const mod = modifierOfCode(e.code)
    if (!mod) return false
    if (mod === 'ctrl' || mod === 'meta') return wantCtrlOrMeta
    return want[mod]
  }
  return codeToKeyName(e.code).toLowerCase() === mainKey.toLowerCase()
}

// 快捷键：按 config.hotkeys 解析匹配（与 manifest command 双保险）。
// 处理器每次按键时读 currentConfig.hotkeys，configChanged 热同步后新配置即时生效。
document.addEventListener('keydown', (e) => {
  const hk = currentConfig.hotkeys ?? DEFAULT_CONFIG.hotkeys
  if (matchHotkey(e, hk.togglePage)) {
    e.preventDefault()
    void togglePageTranslation()
    return
  }
  if (matchHotkey(e, hk.compare)) {
    e.preventDefault()
    // 对比窗由后续模块监听该事件
    document.dispatchEvent(new CustomEvent('tv:compare'))
    return
  }
  if (matchHotkey(e, hk.openOptions)) {
    e.preventDefault()
    const req: BgRequest = { kind: 'command', cmd: 'openOptions' }
    void chrome.runtime.sendMessage(req)
  }
})

// 配置热同步
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['tv:config_v1']) return
  applyConfig(normalizeConfig(changes['tv:config_v1'].newValue))
})

// 消息：popup / background 命令
chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
  if (msg.kind === 'togglePage') {
    void togglePageTranslation().then((active) => {
      sendResponse({ active })
    })
    return true
  }
  if (msg.kind === 'pageState') {
    const counts = pageTranslator.counts()
    const result: PageStateResult = { active: pageTranslator.isActive(), ...counts, host: location.hostname }
    sendResponse(result)
    return false
  }
  if (msg.kind === 'configChanged') {
    applyConfig(msg.config)
    sendResponse(null)
    return false
  }
  return false
})

// 页面卸载/导航：尽力清角标（后台 tabs.onUpdated/onRemoved 还有兜底）
window.addEventListener('pagehide', () => reportBadge(false))
