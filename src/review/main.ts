/**
 * Rtranslate 闪卡复习页 — FSRS 四键评分复习（原生 TS，无框架，10 语言 UI）。
 *
 * 流程：
 * 1. {kind:'getWords'} 取全部生词，本地用 toFsrsCard 转 ts-fsrs Card；
 * 2. 队列 = 到期卡（due <= now）+ 新卡（state === 0），按 due 升序；
 * 3. 正面单词 + 上下文，点击翻面；背面释义 + 上下文 + 笔记；
 * 4. 翻面后显示四键评分（重来/困难/良好/简单），带下一次到期间隔预览
 *    （fsrs.repeat(card, now)[rating].card.due - now 的人类可读时长）；
 * 5. 评分发 {kind:'reviewGrade', wordId, rating}，本地乐观取下一张，
 *    卡片以 0.15s 过渡翻回正面。
 *
 * 快捷键：空格/Enter 翻面；1/2/3/4 或 a/s/d/f 评分。
 *
 * i18n：UI 文案走 t(key, resolveUiLang(config.uiLang), 中文原文)，词条在
 * shared/i18n-pages.ts 注册；storage tv:config_v1 变化时按新语言重渲染。
 */
import { FSRS, Rating, type Card } from 'ts-fsrs'
import { toFsrsCard } from '../shared/store'
import type { BgRequest, BgResponse, WordItem } from '../shared/protocol'
import type { Config } from '../shared/config'
import { fmt, resolveUiLang, t, type ResolvedLang } from '../shared/i18n'
import { watchUiLang } from '../shared/i18n-pages'

// ===== 消息封装 =====

/** 发消息给 background，按 {ok,data}|{ok:false,error} 解包；失败抛错 */
async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) {
    throw new Error('background 未响应')
  }
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

// ===== i18n =====

/** 当前界面语言（zh-CN 为源语言；启动时由 getConfig 解析，storage 变化时更新） */
let uiLang: ResolvedLang = 'zh-CN'

/** 取当前界面语言文案 */
function L(key: string, zh: string): string {
  return t(key, uiLang, zh)
}

// ===== FSRS =====

const fsrs = new FSRS({})

type GradeRating = 1 | 2 | 3 | 4

interface QueueItem {
  word: WordItem
  card: Card
}

/** 复习队列：到期卡 + 新卡，按 due 升序 */
function buildQueue(words: WordItem[], now: number): QueueItem[] {
  return words
    .filter((w) => w.card.due <= now || w.card.state === 0)
    .map((w) => ({ word: w, card: toFsrsCard(w.card) }))
    .sort((a, b) => a.card.due.getTime() - b.card.due.getTime())
}

/** 间隔毫秒 → 人类可读时长（x 分钟 / 小时 / 天 / 个月） */
function humanInterval(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return L('review.interval.lessThanMinute', '<1 分钟')
  if (minutes < 60) {
    return fmt(L('review.interval.minutes', '{n} 分钟'), { n: Math.round(minutes) })
  }
  const hours = minutes / 60
  if (hours < 24) {
    const n = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)
    return fmt(L('review.interval.hours', '{n} 小时'), { n })
  }
  const days = hours / 24
  if (days < 30) {
    const n = days < 10 ? Math.round(days * 10) / 10 : Math.round(days)
    return fmt(L('review.interval.days', '{n} 天'), { n })
  }
  return fmt(L('review.interval.months', '{n} 个月'), { n: Math.max(1, Math.round(days / 30)) })
}

// ===== DOM 小工具 =====

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ===== 页面状态 =====

const app = document.getElementById('app') as HTMLElement | null
if (app === null) throw new Error('缺少 #app 根节点')
const appRoot: HTMLElement = app

let queueSource: WordItem[] = []
let queue: QueueItem[] = []
let pos = 0
let flipped = false
let transitioning = false
let sessionCount = 0
let totalWords = 0

/** 结果面板类型（空词本 / 今日完成 / 本轮完成） */
type ResultKind = 'empty' | 'todayDone' | 'sessionDone'
/** 当前展示的结果面板（null = 复习布局）；界面语言切换时按此重建 */
let resultShown: { kind: ResultKind; canContinue: boolean } | null = null

// 顶部栏（常驻）
const topbar = el('header', 'topbar')
const brand = el('div', 'brand')
brand.append(el('span', 'brand-dot'))
const brandName = el('span', 'brand-name', 'Rtranslate 闪卡复习')
brand.append(brandName)
const progressArea = el('div', 'progress-area')
const progressText = el('div', 'progress-text', '')
const progressBar = el('div', 'progress-bar')
const progressFill = el('div', 'progress-fill')
progressBar.append(progressFill)
progressArea.append(progressText, progressBar)
const exitLink = el('a', 'exit-link', '结束复习')
exitLink.href = '#'
exitLink.addEventListener('click', (e) => {
  e.preventDefault()
  void exitReview()
})
topbar.append(brand, progressArea, exitLink)

// 舞台（卡片 / 评分 / 提示 / 完成态都在这里切换）
const stage = el('main', 'stage')

// 卡片场景：翻面容器
const cardScene = el('div', 'card-scene')
const cardInner = el('div', 'card-inner')
const faceFront = el('div', 'card-face front')
const faceBack = el('div', 'card-face back')
cardInner.append(faceFront, faceBack)
cardScene.append(cardInner)
cardInner.addEventListener('click', () => toggleFlip())

// 评分按钮组
const gradesBox = el('div', 'grades')
const GRADE_DEFS: ReadonlyArray<{
  rating: GradeRating
  cls: string
  labelKey: string
  zh: string
  hotkey: string
}> = [
  { rating: Rating.Again, cls: 'again', labelKey: 'review.grade.again', zh: '重来', hotkey: '1 / A' },
  { rating: Rating.Hard, cls: 'hard', labelKey: 'review.grade.hard', zh: '困难', hotkey: '2 / S' },
  { rating: Rating.Good, cls: 'good', labelKey: 'review.grade.good', zh: '良好', hotkey: '3 / D' },
  { rating: Rating.Easy, cls: 'easy', labelKey: 'review.grade.easy', zh: '简单', hotkey: '4 / F' },
]
const gradeBtns = new Map<GradeRating, HTMLButtonElement>()
for (const def of GRADE_DEFS) {
  const btn = el('button', `grade-btn ${def.cls}`)
  btn.type = 'button'
  btn.append(el('span', 'g-label', def.zh))
  const intervalEl = el('span', 'g-interval', '—')
  btn.append(intervalEl)
  btn.append(el('span', 'g-key', def.hotkey))
  btn.addEventListener('click', () => void grade(def.rating))
  gradeBtns.set(def.rating, btn)
  gradesBox.append(btn)
}

// 键盘提示
const kbdHint = el('div', 'kbd-hint')

/** 按当前界面语言渲染快捷键提示（kbd 结构不变，仅文字随语言） */
function renderKbdHint(): void {
  kbdHint.innerHTML =
    `<span><kbd>${L('review.kbd.space', '空格')}</kbd> / <kbd>Enter</kbd> ${L('review.kbd.flip', '翻面')}</span>` +
    `<span><kbd>1</kbd>~<kbd>4</kbd> ${L('review.kbd.or', '或')} <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd> ${L('review.kbd.grade', '评分')}</span>`
}
renderKbdHint()

// 错误 toast
const toast = el('div', 'toast')
let toastTimer = 0

function showToast(message: string): void {
  toast.textContent = message
  toast.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3000)
}

// ===== 布局切换 =====

/** 进入复习布局：顶部栏 + 舞台（卡片/评分/提示） */
function mountReviewLayout(): void {
  resultShown = null
  appRoot.replaceChildren(topbar, stage, toast)
  stage.replaceChildren(cardScene, gradesBox, kbdHint)
}

/** 进入完成态布局：顶部栏 + 结果面板 */
function mountResultLayout(panel: HTMLElement): void {
  appRoot.replaceChildren(topbar, stage, toast)
  stage.replaceChildren(panel)
}

// ===== 渲染 =====

function updateProgress(): void {
  const total = queue.length
  if (total === 0 || pos >= total) {
    progressText.textContent = ''
    progressFill.style.width = '0%'
    return
  }
  progressText.textContent = fmt(L('review.progress', '第 {pos} / 共 {total} 张'), {
    pos: pos + 1,
    total,
  })
  progressFill.style.width = `${Math.round(((pos + 1) / total) * 100)}%`
}

function current(): QueueItem | undefined {
  return pos < queue.length ? queue[pos] : undefined
}

/** 渲染当前卡片正/反两面（不翻面） */
function renderCard(): void {
  const item = current()
  if (!item) return
  const { word } = item

  faceFront.replaceChildren()
  faceFront.append(el('div', 'card-word', word.word))
  if (word.context) faceFront.append(el('div', 'card-context', word.context))
  const revealBtn = el('button', 'reveal-btn', L('review.reveal', '显示释义'))
  revealBtn.type = 'button'
  revealBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!flipped) flipTo(true)
  })
  faceFront.append(revealBtn)
  faceFront.append(el('div', 'flip-hint', L('review.flipHint', '点击卡片或按 空格 翻面')))

  faceBack.replaceChildren()
  faceBack.append(
    el(
      'div',
      'card-translation',
      word.translation?.trim() ? word.translation : L('review.noTranslation', '（暂无释义）'),
    ),
  )
  if (word.context) faceBack.append(el('div', 'card-context', word.context))
  if (word.note?.trim()) faceBack.append(el('div', 'card-note', word.note))

  applyFlip()
  updateProgress()
}

function applyFlip(): void {
  cardInner.classList.toggle('is-flipped', flipped)
  gradesBox.classList.toggle('show', flipped)
}

/** 翻面（带 0.15s 过渡）；翻面后刷新四个评分按钮的间隔预览 */
function flipTo(next: boolean): void {
  if (transitioning || next === flipped) return
  flipped = next
  if (flipped) updateGradePreviews()
  applyFlip()
}

function toggleFlip(): void {
  if (transitioning) return
  flipTo(!flipped)
}

/** 用 fsrs.repeat 计算四键各自的下一次到期间隔预览 */
function updateGradePreviews(): void {
  const item = current()
  const now = new Date()
  for (const def of GRADE_DEFS) {
    const btn = gradeBtns.get(def.rating)
    const intervalEl = btn?.querySelector<HTMLSpanElement>('.g-interval')
    if (!item || !intervalEl) continue
    try {
      const next = fsrs.repeat(item.card, now)[def.rating]
      intervalEl.textContent = humanInterval(next.card.due.getTime() - now.getTime())
    } catch {
      intervalEl.textContent = '—'
    }
  }
}

// ===== 评分 =====

function grade(rating: GradeRating): void {
  if (!flipped || transitioning) return
  const item = current()
  if (!item) return
  transitioning = true
  sessionCount += 1

  // 本地乐观：先翻回正面，0.15s 过渡后取下一张
  flipped = false
  applyFlip()
  sendBg<unknown>({ kind: 'reviewGrade', wordId: item.word.id, rating }).catch((e: unknown) => {
    showToast(fmt(L('review.toast.gradeFailed', '评分保存失败：{msg}'), { msg: errMsg(e) }))
  })

  window.setTimeout(() => {
    pos += 1
    transitioning = false
    if (pos >= queue.length) {
      void finishSession()
    } else {
      renderCard()
    }
  }, 150)
}

// ===== 完成态 =====

/** 空态/完成态线性图标：卡片 + 对勾（48px，stroke 继承 .result-icon 的 color: #94a3b8） */
const RESULT_ICON_SVG =
  '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="7" y="8" width="26" height="34" rx="4"/>' +
  '<line x1="13" y1="17" x2="27" y2="17"/>' +
  '<line x1="13" y1="23" x2="23" y2="23"/>' +
  '<circle cx="34" cy="34" r="9" fill="#ffffff"/>' +
  '<path d="M29.5 34.5l3 3 6-6.5"/>' +
  '</svg>'

function statBlock(num: number, label: string): HTMLElement {
  const box = el('div', 'stat')
  box.append(el('div', 'stat-num', String(num)))
  box.append(el('div', 'stat-label', label))
  return box
}

/** 结果面板的标题/描述文案（按当前界面语言） */
function resultMeta(kind: ResultKind): { title: string; desc: string } {
  switch (kind) {
    case 'empty':
      return {
        title: L('review.empty.title', '生词本还是空的'),
        desc: L('review.empty.desc', '先从收藏一个生词开始吧。'),
      }
    case 'todayDone':
      return {
        title: L('review.done.title', '今日复习完成'),
        desc: L('review.done.desc', '所有到期卡片都已复习完毕。'),
      }
    case 'sessionDone':
      return {
        title: L('review.sessionDone.title', '本次复习完成'),
        desc: L('review.sessionDone.desc', '本轮卡片已全部评完。'),
      }
  }
}

/** 队列空 / 复习一轮结束后的结果面板 */
function buildResultPanel(opts: { kind: ResultKind; canContinue: boolean }): HTMLElement {
  const meta = resultMeta(opts.kind)
  const panel = el('div', 'result-panel')
  const icon = el('div', 'result-icon')
  icon.innerHTML = RESULT_ICON_SVG
  panel.append(icon)
  panel.append(el('h2', 'result-title', meta.title))
  panel.append(el('p', 'result-desc', meta.desc))

  const stats = el('div', 'result-stats')
  stats.append(statBlock(totalWords, L('review.stats.total', '总词数')))
  const now = Date.now()
  const dueCount = queueSource.filter((w) => w.card.due <= now).length
  stats.append(statBlock(dueCount, L('review.stats.due', '到期数')))
  panel.append(stats)

  if (sessionCount > 0) {
    const session = el('div', 'result-stats')
    session.append(statBlock(sessionCount, L('review.stats.session', '本次已复习')))
    panel.append(session)
  }

  panel.append(el('p', 'result-desc', L('review.result.hint', '去网页上划词收藏生词吧')))

  const actions = el('div', 'result-actions')
  if (opts.canContinue) {
    const againBtn = el('button', 'btn primary', L('review.continue', '继续复习'))
    againBtn.type = 'button'
    againBtn.addEventListener('click', () => void continueSession())
    actions.append(againBtn)
  }
  const doneBtn = el('button', 'btn ghost', L('review.exit', '结束复习'))
  doneBtn.type = 'button'
  doneBtn.addEventListener('click', () => void exitReview())
  actions.append(doneBtn)
  panel.append(actions)
  return panel
}

/** 初始即为空队列：今日完成 / 生词本为空 */
function showInitialEmpty(): void {
  resultShown = { kind: totalWords === 0 ? 'empty' : 'todayDone', canContinue: false }
  mountResultLayout(buildResultPanel(resultShown))
}

/** 一轮复习结束：刷新队列，若仍有到期卡可继续 */
async function finishSession(): Promise<void> {
  try {
    const words = await sendBg<WordItem[]>({ kind: 'getWords' })
    queueSource = words
    totalWords = words.length
    queue = buildQueue(words, Date.now())
  } catch (e) {
    showToast(fmt(L('review.toast.refreshFailed', '刷新队列失败：{msg}'), { msg: errMsg(e) }))
    queue = []
  }
  pos = 0
  flipped = false
  applyFlip()
  updateProgress()
  resultShown = { kind: 'sessionDone', canContinue: queue.length > 0 }
  mountResultLayout(buildResultPanel(resultShown))
}

/** 继续复习新一轮到期卡 */
async function continueSession(): Promise<void> {
  sessionCount = 0
  try {
    const words = await sendBg<WordItem[]>({ kind: 'getWords' })
    queueSource = words
    totalWords = words.length
    queue = buildQueue(words, Date.now())
  } catch (e) {
    showToast(fmt(L('review.toast.loadFailed', '加载生词失败：{msg}'), { msg: errMsg(e) }))
    queue = []
  }
  pos = 0
  flipped = false
  transitioning = false
  if (queue.length === 0) {
    showInitialEmpty()
    return
  }
  mountReviewLayout()
  renderCard()
}

/** 结束复习：回设置页；失败则尝试直接关闭标签页 */
async function exitReview(): Promise<void> {
  try {
    await chrome.runtime.openOptionsPage()
  } catch {
    window.close()
  }
}

// ===== 界面语言 =====

/** 按当前界面语言刷新常驻文案，并重绘当前视图（卡片或结果面板） */
function refreshTexts(): void {
  brandName.textContent = L('review.title', 'Rtranslate 闪卡复习')
  exitLink.textContent = L('review.exit', '结束复习')
  for (const def of GRADE_DEFS) {
    const labelEl = gradeBtns.get(def.rating)?.querySelector<HTMLElement>('.g-label')
    if (labelEl) labelEl.textContent = L(def.labelKey, def.zh)
  }
  renderKbdHint()
  if (resultShown) {
    mountResultLayout(buildResultPanel(resultShown))
  } else {
    renderCard()
    if (flipped) updateGradePreviews()
  }
}

// ===== 键盘快捷键 =====

const KEY_GRADES: Readonly<Record<string, GradeRating>> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  a: 1,
  s: 2,
  d: 3,
  f: 4,
}

document.addEventListener('keydown', (e) => {
  if (queue.length === 0 || pos >= queue.length) return
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    toggleFlip()
    return
  }
  if (flipped && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const rating = KEY_GRADES[e.key.toLowerCase()]
    if (rating) grade(rating)
  }
})

// ===== 启动 =====

async function boot(): Promise<void> {
  mountReviewLayout()
  // 先读界面语言，再以该语言渲染文案
  try {
    const config = await sendBg<Config>({ kind: 'getConfig' })
    uiLang = resolveUiLang(config.uiLang)
  } catch {
    // 配置读取失败保持默认中文
  }
  refreshTexts()
  try {
    const words = await sendBg<WordItem[]>({ kind: 'getWords' })
    queueSource = words
    totalWords = words.length
    queue = buildQueue(words, Date.now())
  } catch (e) {
    showToast(fmt(L('review.toast.loadFailed', '加载生词失败：{msg}'), { msg: errMsg(e) }))
    queue = []
  }
  pos = 0
  sessionCount = 0
  if (queue.length === 0) {
    showInitialEmpty()
    return
  }
  renderCard()
}

// 设置页切换界面语言（storage tv:config_v1 变化）后按新语言重渲染
watchUiLang((next) => {
  if (next === uiLang) return
  uiLang = next
  refreshTexts()
})

void boot()
