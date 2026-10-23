// 悬浮球：拖拽 + 点击切换整页翻译。
export interface BallHooks {
  isActive: () => boolean
  onToggle: () => void
}

let ball: HTMLElement | null = null

export function updateBallState(active: boolean) {
  ball?.classList.toggle('tv-ball-active', active)
}

export function initFloatingBall(enabled: boolean, hooks: BallHooks) {
  if (!enabled) return
  ball = document.createElement('div')
  ball.className = 'tv-ball'
  ball.setAttribute('data-tv-owned', '1')
  ball.setAttribute('translate', 'no')
  ball.textContent = '译'
  ball.title = 'Rtranslate：点击翻译/恢复原文（可拖拽）'
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
  document.addEventListener('mousemove', (e) => {
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
  })
  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    if (!moved) hooks.onToggle()
    updateBallState(hooks.isActive())
  })
}
