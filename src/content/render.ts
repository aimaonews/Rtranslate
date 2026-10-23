// 译文注入、样式复制、加载/错误态、完全可逆的撤销。
// 关键技巧来自 MTranBrowser/OpenImmersive：计算样式逐项复制 + grid/flex/table 容器内插 + data 标记逆操作。
import { buildTranslationHtml } from './dom'
import { getStyle } from '../core/styles'
import type { Config } from '../shared/config'

const INLINE_MAX_LEN = 12

/** 块级译文复制的排版属性（保证"译文与原文是同一篇文档"） */
const STYLE_PROPS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'color',
] as const

function copyTypography(source: Element, target: HTMLElement) {
  const cs = getComputedStyle(source)
  for (const prop of STYLE_PROPS) {
    target.style.setProperty(prop, cs.getPropertyValue(prop), 'important')
  }
  target.style.setProperty('unicode-bidi', 'plaintext', 'important')
}

function makeWrapper(styleId: string): HTMLElement {
  const wrapper = document.createElement('tv-translation')
  wrapper.setAttribute('data-tv-owned', '1')
  wrapper.setAttribute('translate', 'no')
  wrapper.className = `tv-tr ${getStyle(styleId).className}`
  return wrapper
}

export function injectTranslation(
  el: Element,
  translatedHtml: string,
  config: Config,
): HTMLElement {
  removeTranslation(el) // 防御：同节点重复注入前先清
  const wrapper = makeWrapper(config.style.styleId)
  const inner = document.createElement('span')
  inner.className = 'tv-tr-inner'
  inner.setAttribute('lang', config.general.targetLang)
  inner.innerHTML = translatedHtml
  wrapper.appendChild(inner)

  const inline = translatedHtml.replace(/<[^>]+>/g, '').trim().length <= INLINE_MAX_LEN
  if (config.general.displayMode === 'translationOnly') {
    const backup = document.createElement('template')
    backup.className = 'tv-backup'
    while (el.firstChild) backup.content.appendChild(el.firstChild)
    wrapper.prepend(backup)
    el.appendChild(wrapper)
    wrapper.classList.add('tv-tr-replace')
  } else {
    wrapper.classList.add(inline ? 'tv-tr-inline' : 'tv-tr-block')
    if (!inline) copyTypography(el, wrapper)
    el.appendChild(wrapper)
  }
  el.setAttribute('data-tv-translated', '1')
  return wrapper
}

export function removeTranslation(el: Element) {
  const wrapper = el.querySelector(':scope > tv-translation')
  if (!wrapper) return
  const backup = wrapper.querySelector(':scope > template.tv-backup') as HTMLTemplateElement | null
  if (backup) {
    el.insertBefore(backup.content, wrapper)
  }
  wrapper.remove()
  if (el.getAttribute('data-tv-translated') === '1') el.removeAttribute('data-tv-translated')
}

export function removeAllTranslations(root: ParentNode = document) {
  root.querySelectorAll('[data-tv-translated]').forEach((el) => {
    el.removeAttribute('data-tv-translated')
    const w = el.querySelector(':scope > tv-translation')
    if (w) {
      const backup = w.querySelector(':scope > template.tv-backup') as HTMLTemplateElement | null
      if (backup) el.insertBefore(backup.content, w)
      w.remove()
    }
  })
  root.querySelectorAll('tv-translation[data-tv-owned]').forEach((n) => n.remove())
  root.querySelectorAll('[data-tv-loading], [data-tv-error]').forEach((n) => n.remove())
}

// ===== 加载 / 错误态 =====

export function showLoading(el: Element): HTMLElement {
  clearStatus(el)
  const spinner = document.createElement('span')
  spinner.setAttribute('data-tv-owned', '1')
  spinner.setAttribute('data-tv-loading', '1')
  spinner.className = 'tv-loading'
  spinner.title = 'Rtranslate 翻译中…'
  el.appendChild(spinner)
  return spinner
}

export interface ErrorOptions {
  message: string
  onRetry?: () => void
}

export function showError(el: Element, opts: ErrorOptions): HTMLElement {
  clearStatus(el)
  const box = document.createElement('span')
  box.setAttribute('data-tv-owned', '1')
  box.setAttribute('data-tv-error', '1')
  box.className = 'tv-error'
  box.textContent = `⚠ 翻译失败：${opts.message}`
  const retry = document.createElement('button')
  retry.className = 'tv-error-retry'
  retry.textContent = '重试'
  retry.addEventListener('click', (e) => {
    e.stopPropagation()
    if (opts.onRetry) opts.onRetry()
  })
  box.appendChild(retry)
  el.appendChild(box)
  return box
}

export function clearStatus(el: Element) {
  el.querySelectorAll('[data-tv-loading], [data-tv-error]').forEach((n) => n.remove())
}

export { buildTranslationHtml }
