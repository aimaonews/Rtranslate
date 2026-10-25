// 输入框翻译：Alt+Enter 或三连空格触发，整段翻译后写回。
// 写回采用三级降级（参考 KISS smartReplaceText），每层执行后验证（值是否变成译文），失败才降级：
//   1. 富文本/contenteditable：focus → DataTransfer 塞译文 → 合成 ClipboardEvent('paste') 派发
//   2. document.execCommand('insertText')（浏览器原生插入，走完整编辑管线）
//   3a. input/textarea：原生原型 value setter（绕开 React 对实例 value 的重写）+ input/change 事件
//   3b. contenteditable：textContent 直接赋值 + InputEvent
import type { Config } from '../shared/config'
import type { BgResponse, TranslateResult } from '../shared/protocol'
import { ct } from './uiLang'

let config: Config | null = null
let lastKeyTime = 0
let spaceCount = 0
let keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function setInputConfig(c: Config) {
  config = c
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isEditable(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement) {
    const t = el.type
    return ['text', 'search', 'url', 'email', 'password', ''].includes(t) ? el : null
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el
  return null
}

function getText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.textContent ?? ''
}

/** 富文本编辑器（X/Discord/Slack 等通常是 contenteditable 的 div/span） */
function isRichEditor(el: HTMLElement): boolean {
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
}

/** 全选现有内容，让 paste / insertText 覆盖旧文本 */
function selectAll(el: HTMLElement) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select()
    return
  }
  let done = false
  try {
    done = document.execCommand('selectAll', false)
  } catch {
    done = false
  }
  if (!done) {
    try {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.addRange(range)
      }
    } catch {
      /* 选择失败不阻断后续策略 */
    }
  }
}

/** 验证写回结果：当前文本已包含译文（编辑器可能规范化空白，故用 includes） */
function checkSuccess(el: HTMLElement, newText: string): boolean {
  const target = newText.trim()
  if (!target) return getText(el) === newText
  return getText(el).includes(target)
}

function fireContentEditableInput(el: HTMLElement) {
  let evt: Event
  try {
    evt = new InputEvent('input', { bubbles: true })
  } catch {
    evt = new Event('input', { bubbles: true })
  }
  el.dispatchEvent(evt)
}

/**
 * 智能替换文本：三级降级，每层执行后验证，失败才降级。返回是否任一级成功写入译文。
 */
export async function smartReplaceText(el: HTMLElement, newText: string): Promise<boolean> {
  el.focus()
  await sleep(10)
  selectAll(el)
  await sleep(50)

  // 第 1 级：富文本编辑器优先走合成 paste 事件（多数富文本库监听 paste 并读取 clipboardData）
  if (isRichEditor(el)) {
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', newText)
      const pasteEvt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      el.dispatchEvent(pasteEvt)
      await sleep(100) // 给框架处理 paste 的时间
      if (checkSuccess(el, newText)) return true
    } catch {
      /* DataTransfer/ClipboardEvent 不可用或被拦截 → 降级 */
    }
  }

  // 第 2 级：execCommand('insertText')（浏览器原生插入，触发 beforeinput/input 完整管线）
  try {
    if (document.execCommand('insertText', false, newText)) {
      await sleep(20)
      if (checkSuccess(el, newText)) return true
    }
  } catch {
    /* execCommand 不可用（如 jsdom）→ 降级 */
  }

  // 第 3 级：兜底直写
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 原生原型链上的 value setter，绕开 React 等对实例 value 的重写
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, newText)
    else el.value = newText
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.textContent = newText
    fireContentEditableInput(el)
  }
  return checkSuccess(el, newText)
}

function showTip(el: HTMLElement, text: string) {
  document.querySelectorAll('.tv-input-tip').forEach((n) => n.remove())
  const tip = document.createElement('div')
  tip.className = 'tv-input-tip'
  tip.setAttribute('data-tv-owned', '1')
  tip.textContent = text
  document.body.appendChild(tip)
  const rect = el.getBoundingClientRect()
  tip.style.top = `${rect.top - 34}px`
  tip.style.left = `${rect.left}px`
  setTimeout(() => tip.remove(), 2200)
}

async function translateInput(el: HTMLElement, raw: string, targetLang: string) {
  let text = raw
  if (config?.input.trigger === 'tripleSpace') text = raw.replace(/[ =\-]{3}$/, '')
  showTip(el, ct('sel.translating', '翻译中…'))
  try {
    const resp = (await chrome.runtime.sendMessage({
      kind: 'translate', text, targetLang, sourceLang: 'auto',
    })) as BgResponse<TranslateResult>
    if (!resp.ok) throw new Error(resp.error)
    const ok = await smartReplaceText(el, resp.data.text)
    showTip(el, ok ? ct('input.replaced', '已翻译并替换') : ct('input.replaceFailed', '替换失败，请手动粘贴'))
  } catch (err) {
    showTip(el, ct('sel.translateFailed', '翻译失败：') + (err instanceof Error ? err.message : String(err)))
  }
}

export function initInput(c: Config) {
  config = c
  // 幂等：重复初始化先移除旧监听，避免重复触发
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler)
  keydownHandler = (e: KeyboardEvent) => {
    if (!config?.input.enabled) return
    const el = isEditable(e.target)
    if (!el) return
    const trigger = config.input.trigger

    if (trigger === 'altEnter') {
      if (e.altKey && (e.key === 'Enter' || e.code === 'Enter')) {
        e.preventDefault()
        const text = getText(el).trim()
        if (text) void translateInput(el, text, config.input.targetLang)
      }
      return
    }

    // tripleSpace / 三连等号/短横线
    if (e.key === ' ' || e.key === '=' || e.key === '-') {
      const now = Date.now()
      if (now - lastKeyTime < 1000) spaceCount += 1
      else spaceCount = 1
      lastKeyTime = now
      if (spaceCount >= 3) {
        e.preventDefault()
        spaceCount = 0
        const raw = getText(el)
        if (raw.trim()) void translateInput(el, raw, config.input.targetLang)
      }
    } else {
      spaceCount = 0
    }
  }
  document.addEventListener('keydown', keydownHandler)
}
