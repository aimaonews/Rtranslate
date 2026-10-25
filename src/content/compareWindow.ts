// Alt+D 多引擎对比翻译窗：Shadow DOM 隔离的居中浮层。
// 监听 content/index.ts 派发的 'tv:compare' CustomEvent 开合；
// 配置在开窗时经 getConfig 现取（热同步自然生效，无需 index.ts 额外接线）。
//
// 样式说明：Shadow DOM 与文档样式互相隔离，public/content.css 里的
// .tv-compare-* 规则无法穿透，因此浮层样式以 <style> 内联在 shadow 中；
// 两处类名与 token 值保持一致（:root 的 --tv-* 自定义属性可继承进 shadow，
// 内联样式用 var(..., 兜底值) 引用，content.css 那份作为规范副本维护）。

import { DEFAULT_CONFIG, type Config } from '../shared/config'
import type { BgResponse } from '../shared/protocol'
import { ct } from './uiLang'

/** 与 background/compare.ts 的 CompareResult 对齐（content 不跨边界 import background 实现） */
interface CompareResultItem {
  engineId: string
  name: string
  text?: string
  error?: string
  elapsedMs: number
}

/** 引擎显示名（卡片标题）；zh 界面用中文品牌名，其余用国际名；未知引擎回退注册表 name / id。 */
const ENGINE_NAMES_ZH: Record<string, string> = {
  google: '谷歌',
  bing: '微软',
  mymemory: 'MyMemory',
  deepl: 'DeepL',
  openai: 'OpenAI 兼容',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  gemini: 'Gemini',
  libretranslate: 'LibreTranslate',
  custom: '自定义',
}
const ENGINE_NAMES_EN: Record<string, string> = {
  google: 'Google',
  bing: 'Microsoft',
  mymemory: 'MyMemory',
  deepl: 'DeepL',
  openai: 'OpenAI-compatible',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  gemini: 'Gemini',
  libretranslate: 'LibreTranslate',
  custom: 'Custom',
}

function engineNames(): Record<string, string> {
  return ct('cmp.engine.google', '谷歌') === '谷歌' ? ENGINE_NAMES_ZH : ENGINE_NAMES_EN
}

const DEFAULT_COMPARE_ENGINES = ['google', 'bing']

/** shadow 内联样式：与 public/content.css 的 .tv-compare-* 规范副本同值同步。 */
const SHADOW_CSS = `
:host { all: initial; }
.tv-compare-overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 8vh 16px 16px; box-sizing: border-box;
  font: 14px/1.6 var(--tv-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif);
  color: var(--tv-text, #1e293b);
}
.tv-compare-panel {
  width: 100%; max-width: 720px; max-height: 84vh;
  display: flex; flex-direction: column;
  background: var(--tv-card, #ffffff);
  border-radius: var(--tv-radius-lg, 14px);
  box-shadow: var(--tv-shadow-lg, 0 10px 32px rgba(15, 23, 42, 0.14));
  padding: 16px; box-sizing: border-box;
  animation: tv-compare-pop 0.15s ease;
}
@keyframes tv-compare-pop { from { opacity: 0; transform: translateY(6px) scale(0.99); } }
.tv-compare-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tv-compare-title { font: 700 15px var(--tv-font, sans-serif); color: var(--tv-text, #1e293b); }
.tv-compare-close {
  border: 0; background: transparent; cursor: pointer;
  width: 28px; height: 28px; border-radius: var(--tv-radius-sm, 6px);
  font: 18px/1 var(--tv-font, sans-serif); color: var(--tv-text-sub, #64748b);
}
.tv-compare-close:hover { background: rgba(15, 23, 42, 0.06); color: var(--tv-text, #1e293b); }
.tv-compare-input {
  width: 100%; min-height: 72px; max-height: 160px; box-sizing: border-box;
  resize: vertical; padding: 8px 10px;
  font: 13px/1.6 var(--tv-font, sans-serif); color: var(--tv-text, #1e293b);
  border: 1px solid var(--tv-border-strong, #d4d9e2);
  border-radius: var(--tv-radius-md, 10px);
  outline: none; background: var(--tv-card, #ffffff);
}
.tv-compare-input:focus { border-color: var(--tv-primary, #409eff); box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.18); }
.tv-compare-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0 12px; }
.tv-compare-target { font-size: 12px; color: var(--tv-text-sub, #64748b); }
.tv-compare-run {
  border: 1px solid var(--tv-primary-strong, #337ecc);
  background: var(--tv-primary-strong, #337ecc); color: #fff;
  height: 30px; padding: 0 16px; border-radius: var(--tv-radius-sm, 6px);
  font: 13px var(--tv-font, sans-serif); cursor: pointer;
}
.tv-compare-run:hover { opacity: 0.88; }
.tv-compare-run:disabled { opacity: 0.55; cursor: default; }
.tv-compare-results {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px; overflow-y: auto; min-height: 60px;
}
.tv-compare-hint { grid-column: 1 / -1; text-align: center; color: var(--tv-text-faint, #94a3b8); font-size: 12px; padding: 18px 0; }
.tv-compare-card {
  background: var(--tv-card, #ffffff);
  border: 1px solid var(--tv-border, #e4e7ed);
  border-radius: var(--tv-radius-lg, 14px);
  box-shadow: var(--tv-shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.06));
  padding: 10px 12px; min-width: 0;
}
.tv-compare-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tv-compare-engine { font: 700 13px var(--tv-font, sans-serif); color: var(--tv-primary-text, #2b6cb0); }
.tv-compare-elapsed { font-size: 11px; color: var(--tv-text-faint, #94a3b8); }
.tv-compare-card-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.tv-compare-spin {
  display: inline-block; width: 13px; height: 13px; margin-right: 6px;
  border: 2px solid rgba(64, 158, 255, 0.25); border-top-color: var(--tv-primary, #409eff);
  border-radius: 50%; animation: tv-compare-rot 0.8s linear infinite; vertical-align: -2px;
}
@keyframes tv-compare-rot { to { transform: rotate(360deg); } }
.tv-compare-error { color: var(--tv-danger-text, #c4564a); font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
  .tv-compare-panel { animation-duration: 0.01ms; }
  .tv-compare-spin { animation-duration: 1.6s; }
}
`

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let currentConfig: Config = DEFAULT_CONFIG

async function bg<T>(msg: unknown): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T>
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function getSelectionText(): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return ''
  return sel.toString().trim()
}

function engineLabel(id: string, fallback?: string): string {
  return engineNames()[id] ?? fallback ?? id
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function closeWindow(): void {
  host?.remove()
  host = null
  shadow = null
}

/** 结果区渲染：先按引擎建卡片（各带独立 spinner），响应到达后逐卡填充。 */
function runCompare(text: string): void {
  if (!shadow) return
  const results = shadow.querySelector<HTMLElement>('.tv-compare-results')
  const runBtn = shadow.querySelector<HTMLButtonElement>('.tv-compare-run')
  if (!results || !runBtn) return

  const rawIds =
    currentConfig.compareEngines.length > 0 ? currentConfig.compareEngines : DEFAULT_COMPARE_ENGINES
  const ids = rawIds.filter((id, i) => rawIds.indexOf(id) === i)
  results.textContent = ''
  runBtn.disabled = true

  const bodies = new Map<string, { body: HTMLElement; elapsed: HTMLElement }>()
  for (const id of ids) {
    const card = document.createElement('div')
    card.className = 'tv-compare-card'
    const head = document.createElement('div')
    head.className = 'tv-compare-card-head'
    const name = document.createElement('span')
    name.className = 'tv-compare-engine'
    name.textContent = engineLabel(id)
    const elapsed = document.createElement('span')
    elapsed.className = 'tv-compare-elapsed'
    head.append(name, elapsed)
    const body = document.createElement('div')
    body.className = 'tv-compare-card-body'
    const spin = document.createElement('span')
    spin.className = 'tv-compare-spin'
    body.append(spin, document.createTextNode(ct('sel.translating', '翻译中…')))
    card.append(head, body)
    results.appendChild(card)
    bodies.set(id, { body, elapsed })
  }

  bg<CompareResultItem[]>({
    kind: 'compareTranslate',
    text,
    targetLang: currentConfig.general.targetLang,
    engineIds: ids,
  })
    .then((items) => {
      for (const item of items) {
        const slot = bodies.get(item.engineId)
        if (!slot) continue
        slot.elapsed.textContent = formatElapsed(item.elapsedMs)
        slot.body.textContent = ''
        if (item.error !== undefined) {
          const e = document.createElement('span')
          e.className = 'tv-compare-error'
          e.textContent = ct('cmp.engineFailed', '失败：') + item.error
          slot.body.appendChild(e)
        } else {
          slot.body.textContent = item.text ?? ''
        }
        // 卡片标题补全注册表名（未知引擎的兜底）
        const nameEl = slot.body.parentElement?.querySelector('.tv-compare-engine')
        if (nameEl && !engineNames()[item.engineId]) nameEl.textContent = engineLabel(item.engineId, item.name)
      }
    })
    .catch((e: Error) => {
      results.textContent = ''
      const hint = document.createElement('div')
      hint.className = 'tv-compare-hint'
      hint.textContent = ct('cmp.runFailed', '对比翻译失败：') + e.message
      results.appendChild(hint)
    })
    .finally(() => {
      runBtn.disabled = false
    })
}

async function openWindow(initialText: string): Promise<void> {
  closeWindow()
  try {
    currentConfig = await bg<Config>({ kind: 'getConfig' })
  } catch {
    currentConfig = DEFAULT_CONFIG
  }

  host = document.createElement('div')
  host.setAttribute('data-tv-owned', '1')
  host.setAttribute('translate', 'no')
  shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = SHADOW_CSS

  const overlay = document.createElement('div')
  overlay.className = 'tv-compare-overlay'
  const panel = document.createElement('div')
  panel.className = 'tv-compare-panel'

  const header = document.createElement('div')
  header.className = 'tv-compare-header'
  const title = document.createElement('span')
  title.className = 'tv-compare-title'
  title.textContent = ct('cmp.title', '多引擎对比翻译')
  const closeBtn = document.createElement('button')
  closeBtn.className = 'tv-compare-close'
  closeBtn.type = 'button'
  closeBtn.textContent = '×'
  closeBtn.title = ct('cmp.close', '关闭 (Esc)')
  header.append(title, closeBtn)

  const input = document.createElement('textarea')
  input.className = 'tv-compare-input'
  input.placeholder = ct('cmp.placeholder', '输入要对比翻译的文本…')
  input.value = initialText

  const toolbar = document.createElement('div')
  toolbar.className = 'tv-compare-toolbar'
  const target = document.createElement('span')
  target.className = 'tv-compare-target'
  target.textContent = ct('cmp.targetLang', '目标语言：') + currentConfig.general.targetLang
  const runBtn = document.createElement('button')
  runBtn.className = 'tv-compare-run'
  runBtn.type = 'button'
  runBtn.textContent = ct('cmp.run', '对比翻译')
  toolbar.append(target, runBtn)

  const results = document.createElement('div')
  results.className = 'tv-compare-results'
  const hint = document.createElement('div')
  hint.className = 'tv-compare-hint'
  hint.textContent = ct('cmp.hint', '输入文本后点击「对比翻译」')
  results.appendChild(hint)

  panel.append(header, input, toolbar, results)
  overlay.appendChild(panel)
  shadow.append(style, overlay)
  document.body.appendChild(host)

  // 点击遮罩关闭（点面板内部不关闭）
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeWindow()
  })
  closeBtn.addEventListener('click', () => closeWindow())

  // 面板内按键不冒泡给页面/其他快捷键；Esc 本地处理关闭，Ctrl+Enter 触发对比
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      closeWindow()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      runBtn.click()
    }
  })
  runBtn.addEventListener('click', () => {
    const text = input.value.trim()
    if (!text) {
      input.focus()
      return
    }
    runCompare(text)
  })

  input.focus()
  input.select()
  if (initialText) runCompare(initialText)
}

/** 装配入口：监听 index.ts 派发的 'tv:compare'。已打开时再触发 = 关闭（toggle）。 */
export function initCompareWindow(): void {
  document.addEventListener('tv:compare', () => {
    if (host) {
      closeWindow()
      return
    }
    void openWindow(getSelectionText())
  })
  // 焦点在页面空白处时的 Esc 兜底关闭（面板内 Esc 已本地处理）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host) closeWindow()
  })
}
