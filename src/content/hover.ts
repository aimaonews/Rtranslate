// 悬停翻译：按住修饰键（或纯悬停）划过段落即译。参考 MTranBrowser 的鼠标悬停快捷键设计。
import { translateElement } from './page'
import type { Config } from '../shared/config'

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption, dd, dt'

let config: Config | null = null
let lastEl: Element | null = null
let throttleTimer: ReturnType<typeof setTimeout> | null = null

export function setHoverConfig(c: Config) {
  config = c
}

function modifierActive(e: MouseEvent): boolean {
  const key = config?.hover.key ?? 'alt'
  switch (key) {
    case 'alt': return e.altKey
    case 'ctrl': return e.ctrlKey
    case 'shift': return e.shiftKey
    case 'none': return true
  }
}

function findBlock(target: Element | null): Element | null {
  if (!target) return null
  const el = target.closest(BLOCK_SELECTOR)
  if (!el) return null
  if (el.closest('[data-tv-owned], script, style, code, pre, input, textarea, [contenteditable="true"]')) return null
  return el
}

export function initHover(c: Config) {
  config = c
  document.addEventListener('mouseover', (e) => {
    if (!config?.hover.enabled) return
    if (!modifierActive(e)) return
    if (throttleTimer) return
    throttleTimer = setTimeout(() => (throttleTimer = null), 120)
    const el = findBlock(e.target as Element | null)
    if (!el || el === lastEl) return
    lastEl = el
    void translateElement(el, config)
  })
  document.addEventListener('mouseout', (e) => {
    if (lastEl && !lastEl.contains(e.relatedTarget as Node | null)) lastEl = null
  })
}
