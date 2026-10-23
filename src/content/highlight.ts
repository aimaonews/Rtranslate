// 生词高亮：把生词本中的词在页面上包 <mark>，悬停显示释义。
import type { BgResponse, WordItem } from '../shared/protocol'

let tip: HTMLElement | null = null

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function removeHighlights(root: ParentNode = document) {
  root.querySelectorAll('mark.tv-hl').forEach((m) => {
    const parent = m.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m)
    parent.normalize()
  })
}

function buildMatcher(words: WordItem[]): RegExp | null {
  const parts = words
    .map((w) => w.word.trim())
    .filter((w) => w.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((w) => {
      if (/^[\x20-\x7e]+$/.test(w)) {
        // 纯 ASCII：整词边界
        return `\\b${escapeRe(w)}\\b`
      }
      return escapeRe(w)
    })
  if (!parts.length) return null
  return new RegExp(`(${parts.join('|')})`, 'gi')
}

function showTip(target: HTMLElement, word: WordItem) {
  hideTip()
  tip = document.createElement('div')
  tip.className = 'tv-hl-tip'
  tip.setAttribute('data-tv-owned', '1')
  tip.textContent = `${word.word}${word.translation ? ` — ${word.translation}` : ''}${word.context ? `\n${word.context.slice(0, 120)}` : ''}`
  document.body.appendChild(tip)
  const rect = target.getBoundingClientRect()
  tip.style.top = `${rect.bottom + window.scrollY + 4}px`
  tip.style.left = `${rect.left + window.scrollX}px`
}

function hideTip() {
  tip?.remove()
  tip = null
}

export async function applyHighlights(enabled: boolean) {
  removeHighlights()
  if (!enabled) return
  const resp = (await chrome.runtime.sendMessage({ kind: 'getWords' })) as BgResponse<WordItem[]>
  if (!resp.ok) return
  const words = resp.data.filter((w) => w.word.trim().length >= 2)
  const re = buildMatcher(words)
  if (!re) return
  const byWord = new Map(words.map((w) => [w.word.toLowerCase(), w]))

  const SKIP = 'script,style,noscript,template,iframe,textarea,input,select,[data-tv-owned],tv-translation,mark.tv-hl,pre,code'
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || !parent.isConnected) return NodeFilter.FILTER_REJECT
      if (parent.closest(SKIP)) return NodeFilter.FILTER_REJECT
      if (!(node as Text).data.trim()) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const targets: Text[] = []
  while (walker.nextNode()) targets.push(walker.currentNode as Text)
  for (const textNode of targets) {
    const text = textNode.data
    re.lastIndex = 0
    if (!re.test(text)) continue
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of text.matchAll(re)) {
      const idx = m.index
      frag.appendChild(document.createTextNode(text.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = 'tv-hl'
      mark.setAttribute('data-tv-owned', '1')
      mark.textContent = m[0]
      const word = byWord.get(m[0].toLowerCase())
      if (word) {
        mark.addEventListener('mouseenter', () => showTip(mark, word))
        mark.addEventListener('mouseleave', hideTip)
      }
      frag.appendChild(mark)
      last = idx + m[0].length
    }
    frag.appendChild(document.createTextNode(text.slice(last)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }
}
