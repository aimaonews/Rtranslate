// 悬浮球：拖拽 + 点击切换整页翻译。支持运行时开关（关闭即移除 DOM 与监听，无需刷新页面）。
import { ct, ballGlyph } from './uiLang'
export interface BallHooks {
  isActive: () => boolean
  onToggle: () => void
}

let ball: HTMLElement | null = null
let hooks: BallHooks | null = null
let mousemoveHandler: ((e: MouseEvent) => void) | null = null
let mouseupHandler: (() => void) | null = null

export function updateBallState(active: boolean) {
  ball?.classList.toggle('tv-ball-active', active)
}

/** 移除悬浮球 DOM 与 document 级监听 */
function disposeBall() {
  if (mousemoveHandler) document.removeEventListener('mousemove', mousemoveHandler)
  if (mouseupHandler) document.removeEventListener('mouseup', mouseupHandler)
  mousemoveHandler = null
  mouseupHandler = null
  ball?.remove()
  ball = null
}

/**
 * 运行时开关悬浮球：enabled=true 创建（或保持），false 销毁。
 * 配置热同步时由 applyConfig 调用，无需刷新页面。
 */
export function toggleFloatingBall(enabled: boolean, h: BallHooks) {
  if (!enabled) {
    disposeBall()
    return
  }
  if (ball) {
    // 已存在：界面语言可能变化，刷新字符与提示
    ball.textContent = ballGlyph()
    ball.title = ct('ball.tip', 'Rtranslate：点击翻译/恢复原文（可拖拽）')
    return
  }
  hooks = h
  ball = document.createElement('div')
  ball.className = 'tv-ball'
  ball.setAttribute('data-tv-owned', '1')
  ball.setAttribute('translate', 'no')
  ball.textContent = ballGlyph()
  ball.title = ct('ball.tip', 'Rtranslate：点击翻译/恢复原文（可拖拽）')
  document.body.appendChild(ball)

  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let baseLeft = 0
  let baseTop = 0

  ball.addEventListener('mousedown', (e) => {
    dragging = true
    moved = false
    startX = e.clientX
    startY = e.clientY
    const rect = ball!.getBoundingClientRect()
    baseLeft = rect.left
    baseTop = rect.top
    e.preventDefault()
  })
  mousemoveHandler = (e: MouseEvent) => {
    if (!dragging || !ball) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.abs(dx) + Math.abs(dy) > 5) moved = true
    if (moved) {
      const left = Math.min(window.innerWidth - 44, Math.max(0, baseLeft + dx))
      const top = Math.min(window.innerHeight - 44, Math.max(0, baseTop + dy))
      ball.style.left = `${left}px`
      ball.style.top = `${top}px`
      ball.style.right = 'auto'
      ball.style.bottom = 'auto'
    }
  }
  mouseupHandler = () => {
    if (!dragging) return
    dragging = false
    if (!moved) hooks?.onToggle()
    updateBallState(hooks?.isActive() ?? false)
  }
  document.addEventListener('mousemove', mousemoveHandler)
  document.addEventListener('mouseup', mouseupHandler)
}

/** 兼容旧接口（首次初始化） */
export function initFloatingBall(enabled: boolean, h: BallHooks) {
  toggleFloatingBall(enabled, h)
}
