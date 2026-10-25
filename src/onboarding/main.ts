/**
 * Rtranslate 首次安装引导页 — 三步卡片式向导（原生 TS，无框架，10 语言 UI）。
 *
 * 三步：
 * 1. 欢迎与基础设置：目标语言（LANGS 全量，常用置顶）、翻译引擎（AI猫置顶 + 内置 +
 *    customEngines，16px 图标）、显示模式单选卡片；全部即改即存
 *    （{kind:'setConfig',patch} 写入 tv:config_v1，与 popup 同一键），不等最后一步；
 * 2. 固定到工具栏：三步图文指引（拼图图标 → 找到 Rtranslate → 图钉固定）；
 * 3. 交互初体验：选中示例英文句即调 {kind:'translate'} 实时显示译文，未选中时显示引导提示；
 *    “完成设置，开始使用”写入 onboardingCompleted:true 并切换到完成态。
 *
 * i18n：UI 文案走 t(key, resolveUiLang(config.uiLang), 中文原文)，onboarding.* 词条在
 * shared/i18n-pages.ts 注册；storage tv:config_v1 中 uiLang 变化时按新语言重渲染。
 */
import { LANGS, COMMON_LANG_CODES, langNative } from '../core/langs'
import type { Config } from '../shared/config'
import { fmt, resolveUiLang, t, type ResolvedLang } from '../shared/i18n'
import { watchUiLang } from '../shared/i18n-pages'
import type { BgRequest, BgResponse, TranslateResult } from '../shared/protocol'
import { BUILTIN_ENGINES, engineName } from '../shared/engines'

// ===== 消息封装 =====

/** 发消息给 background，按 {ok,data}|{ok:false,error} 解包；失败抛错 */
async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) {
    throw new Error(L('ob.s1', 'background 未响应'))
  }
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

// ===== 引擎选项（与 popup 保持一致：AI猫置顶 + 内置引擎 + customEngines） =====

interface EngineOption {
  id: string
  name: string
  /** public/engine-icons/ 下的相对路径 */
  icon: string
}

const ENGINE_ICON_FILES: Record<string, string> = {
  aimao: 'engine-icons/aimao.png',
  google: 'engine-icons/google.svg',
  bing: 'engine-icons/bing.svg',
  mymemory: 'engine-icons/mymemory.png',
  deepl: 'engine-icons/deepl.svg',
  openai: 'engine-icons/openai.svg',
  deepseek: 'engine-icons/deepseek.svg',
  claude: 'engine-icons/claude.svg',
  gemini: 'engine-icons/gemini.svg',
  libretranslate: 'engine-icons/libretranslate.png',
  custom: 'engine-icons/custom.svg',
}

/** 引擎 id → 图标相对路径；custom:<id> 与未知 id 一律用 custom.svg */
function engineIconFor(id: string): string {
  if (id.startsWith('custom:')) return ENGINE_ICON_FILES.custom
  return ENGINE_ICON_FILES[id] ?? ENGINE_ICON_FILES.custom
}

/** 引擎下拉选项：AI猫第一 + 内置引擎 + config.engine.customEngines（id 为 custom:<entryId>） */
function getEngineOptions(cfg: Config): EngineOption[] {
  const options: EngineOption[] = BUILTIN_ENGINES.map((e) => ({ id: e.id, name: engineName(e, uiLang), icon: engineIconFor(e.id) }))
  for (const entry of cfg.engine.customEngines) {
    options.push({
      id: `custom:${entry.id}`,
      name: entry.name,
      icon: engineIconFor(`custom:${entry.id}`),
    })
  }
  return options
}

// ===== 常量 =====

/** Step 3 划词演示的英文示例文本（各界面语言统一为英文原文） */
const SAMPLE_TEXT = 'The best way to learn a language is to read what you love.'

const DONE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'

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

const appRoot = document.getElementById('app') as HTMLElement | null
if (appRoot === null) throw new Error(L('ob.s2', '缺少 #app 根节点'))
const app: HTMLElement = appRoot

let config: Config | null = null
/** 当前界面语言（zh-CN 为源语言；启动时由 getConfig 解析，storage 变化时更新） */
let uiLang: ResolvedLang = 'zh-CN'
/** 当前向导步（1/2/3） */
let step: 1 | 2 | 3 = 1
/** 完成态（写完 onboardingCompleted 后展示） */
let completed = false

/** 当前渲染根；document 级 selectionchange 监听借此识别过期模块实例（测试多次 boot） */
let renderedRoot: HTMLElement | null = null

// Step 3 演示状态
type DemoState = 'idle' | 'loading' | 'done' | 'error'
let demoState: DemoState = 'idle'
let demoText = ''
let demoResultEl: HTMLElement | null = null
let lastSelection = ''

/** 取当前界面语言文案 */
function L(key: string, zh: string): string {
  return t(key, uiLang, zh)
}

// ===== 配置写入（即改即存） =====

/**
 * 乐观更新本地 config 并重渲染，再发 {kind:'setConfig',patch} 落盘；
 * 失败保留乐观值（与 popup 的容错策略一致）。
 */
async function applyPatch(patch: Partial<Config>): Promise<void> {
  if (!config) return
  config = { ...config, ...patch }
  render()
  try {
    const next = await sendBg<Config>({ kind: 'setConfig', patch })
    if (next) config = next
  } catch {
    // 写盘失败：保持乐观值，不打断向导
  }
}

// ===== 顶部：品牌 + 进度条 =====

function buildProgress(): HTMLElement {
  const wrap = el('header', 'ob-head')

  const brand = el('div', 'ob-brand')
  const logo = el('img', 'ob-logo') as HTMLImageElement
  logo.src = chrome.runtime.getURL('icons/icon128.png')
  logo.alt = 'Rtranslate'
  logo.width = 36
  logo.height = 36
  brand.append(logo, el('span', 'ob-brand-name', 'Rtranslate'))
  wrap.append(brand)

  const progress = el('div', 'ob-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-valuemin', '1')
  progress.setAttribute('aria-valuemax', '3')
  progress.setAttribute('aria-valuenow', String(completed ? 3 : step))
  progress.setAttribute(
    'aria-label',
    fmt(L('onboarding.progress', '第 {n} 步，共 {total} 步'), { n: completed ? 3 : step, total: 3 }),
  )
  const active = completed ? 3 : step
  for (let i = 1; i <= 3; i++) {
    const seg = el('span', 'ob-progress-seg')
    if (i === active) seg.classList.add('is-active')
    else if (i < active) seg.classList.add('is-done')
    progress.append(seg)
  }
  wrap.append(progress)
  return wrap
}

// ===== Step 1：欢迎与基础设置 =====

/** 目标语言下拉：LANGS 全量，常用置顶（optgroup 分组） */
function buildTargetLangSelect(cfg: Config): HTMLSelectElement {
  const sel = el('select', 'ob-select ob-target-lang')
  sel.setAttribute('aria-label', L('onboarding.field.targetLang', '目标语言'))
  const commonGroup = el('optgroup')
  commonGroup.label = L('onboarding.commonLangs', '常用语言')
  const allGroup = el('optgroup')
  allGroup.label = L('onboarding.allLangs', '全部语言')
  const commonSet = new Set<string>(COMMON_LANG_CODES)
  for (const l of LANGS) {
    if (l.code === 'auto') continue // 目标语言不需要自动检测
    const opt = el('option')
    opt.value = l.code
    opt.textContent = langNative(l.code)
    if (commonSet.has(l.code)) commonGroup.append(opt)
    else allGroup.append(opt)
  }
  sel.append(commonGroup, allGroup)
  const current = cfg.general.targetLang
  sel.value = current
  if (sel.value !== current) {
    // 未知语言码：兜底展示原码，避免下拉空白
    const opt = el('option')
    opt.value = current
    opt.textContent = langNative(current)
    commonGroup.append(opt)
    sel.value = current
  }
  sel.addEventListener('change', () => {
    if (!config) return
    void applyPatch({ general: { ...config.general, targetLang: sel.value } })
  })
  return sel
}

/** 16px 引擎图标；加载失败时隐藏（如图标文件缺失） */
function engineIconImg(icon: string): HTMLImageElement {
  const img = el('img', 'ob-engine-icon') as HTMLImageElement
  img.src = chrome.runtime.getURL(icon)
  img.alt = ''
  img.width = 16
  img.height = 16
  img.addEventListener('error', () => {
    img.style.display = 'none'
  })
  return img
}

/** 翻译引擎自定义下拉：getEngineOptions(config)，每项 16px 图标 + 名称（原生 option 不支持图片） */
function buildEngineSelect(cfg: Config): HTMLElement {
  const options = getEngineOptions(cfg)
  if (!options.some((o) => o.id === cfg.engine.provider)) {
    // 配置中的引擎不在列表（如旧单 custom、已删除的自定义引擎）：兜底展示，避免空白
    options.push({
      id: cfg.engine.provider,
      name: cfg.engine.provider,
      icon: engineIconFor(cfg.engine.provider),
    })
  }

  const wrap = el('div', 'ob-engine')

  const btn = el('button', 'ob-engine-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'listbox')
  btn.setAttribute('aria-label', L('onboarding.field.engine', '翻译引擎'))

  const list = el('ul', 'ob-engine-list')
  list.setAttribute('role', 'listbox')

  const current = options.find((o) => o.id === cfg.engine.provider) ?? options[0]
  btn.append(
    engineIconImg(current.icon),
    el('span', 'ob-engine-name', current.name),
    el('span', 'ob-caret'),
  )

  for (const o of options) {
    const item = el('li', 'ob-engine-item')
    item.setAttribute('role', 'option')
    item.dataset.engineId = o.id
    const on = o.id === cfg.engine.provider
    item.classList.toggle('is-selected', on)
    item.setAttribute('aria-selected', String(on))
    item.append(engineIconImg(o.icon), el('span', 'ob-engine-item-name', o.name))
    item.addEventListener('click', () => {
      close()
      if (!config) return
      void applyPatch({ engine: { ...config.engine, provider: o.id } })
    })
    list.append(item)
  }

  function open(): void {
    wrap.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    document.addEventListener('click', onDocClick)
  }

  function close(): void {
    wrap.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDocClick)
  }

  function onDocClick(e: MouseEvent): void {
    if (!wrap.contains(e.target as Node)) close()
  }

  btn.addEventListener('click', () => {
    if (wrap.classList.contains('open')) close()
    else open()
  })
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  wrap.append(btn, list)
  return wrap
}

/** 显示模式单选卡片（双语对照 / 仅译文） */
function buildDisplayModeRadios(cfg: Config): HTMLElement {
  const group = el('div', 'ob-radio-group')
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', L('onboarding.field.displayMode', '显示模式'))
  const MODES: ReadonlyArray<{
    value: Config['general']['displayMode']
    labelKey: string
    labelZh: string
    descKey: string
    descZh: string
  }> = [
    {
      value: 'bilingual',
      labelKey: 'onboarding.mode.bilingual',
      labelZh: L('ob.s3', '双语对照'),
      descKey: 'onboarding.mode.bilingualDesc',
      descZh: L('ob.s4', '保留原文，在下方显示译文'),
    },
    {
      value: 'translationOnly',
      labelKey: 'onboarding.mode.translationOnly',
      labelZh: L('ob.s5', '仅译文'),
      descKey: 'onboarding.mode.translationOnlyDesc',
      descZh: L('ob.s6', '隐藏原文，只显示译文'),
    },
  ]
  for (const m of MODES) {
    const item = el('label', 'ob-radio-item')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'ob-display-mode'
    radio.value = m.value
    radio.checked = cfg.general.displayMode === m.value
    const text = el('span', 'ob-radio-text')
    text.append(
      el('span', 'ob-radio-label', L(m.labelKey, m.labelZh)),
      el('span', 'ob-radio-desc', L(m.descKey, m.descZh)),
    )
    item.append(radio, text)
    radio.addEventListener('change', () => {
      if (!config || !radio.checked) return
      void applyPatch({
        general: { ...config.general, displayMode: m.value },
      })
    })
    group.append(item)
  }
  return group
}

function buildField(labelText: string, control: HTMLElement): HTMLElement {
  const field = el('div', 'ob-field')
  field.append(el('span', 'ob-field-label', labelText), control)
  return field
}

/** 左下角弱化“跳过”链接：直接完成引导（写 onboardingCompleted:true），与“下一步”主按钮形成主次 */
function buildSkipLink(): HTMLButtonElement {
  const skip = el('button', 'ob-skip', L('onboarding.skip', '跳过，使用默认设置'))
  skip.type = 'button'
  skip.addEventListener('click', () => {
    skip.disabled = true
    void onFinish()
  })
  return skip
}

function buildStep1(cfg: Config): HTMLElement {
  const section = el('section', 'ob-step ob-step-1')

  section.append(
    el('h1', 'ob-step-title', L('onboarding.welcome.title', '欢迎使用 Rtranslate')),
    el(
      'p',
      'ob-step-desc',
      L('onboarding.welcome.subtitle', '网页翻译、划词翻译、悬停查词——一次设置，随处可用。'),
    ),
  )

  section.append(
    buildField(L('onboarding.field.targetLang', '目标语言'), buildTargetLangSelect(cfg)),
    buildField(L('onboarding.field.engine', '翻译引擎'), buildEngineSelect(cfg)),
    buildField(L('onboarding.field.displayMode', '显示模式'), buildDisplayModeRadios(cfg)),
  )

  const actions = el('div', 'ob-actions')
  const next = el('button', 'ob-btn primary ob-next', L('onboarding.next', '下一步'))
  next.type = 'button'
  next.addEventListener('click', () => {
    step = 2
    render()
  })
  actions.append(buildSkipLink(), next)
  section.append(actions)
  return section
}

// ===== Step 2：固定到工具栏 =====

function buildStep2(): HTMLElement {
  const section = el('section', 'ob-step ob-step-2')

  section.append(
    el('h1', 'ob-step-title', L('onboarding.pin.title', '把 Rtranslate 固定到工具栏')),
    el(
      'p',
      'ob-step-desc',
      L('onboarding.pin.desc', '固定到工具栏后，随时一键翻译整页或查生词。'),
    ),
  )

  const steps = el('div', 'ob-pin-steps')
  const rows: ReadonlyArray<{ icon: string; text: string }> = [
    { icon: '🧩', text: L('onboarding.pin.step1', '点击浏览器右上角的拼图图标') },
    { icon: 'ext', text: L('onboarding.pin.step2', '在列表中找到 Rtranslate') },
    { icon: '📌', text: L('onboarding.pin.step3', '点击图钉图标，将它固定到工具栏') },
  ]
  rows.forEach((row, idx) => {
    const item = el('div', 'ob-pin-step')
    item.append(el('span', 'ob-pin-num', String(idx + 1)))
    if (row.icon === 'ext') {
      const img = el('img', 'ob-pin-ext-icon') as HTMLImageElement
      img.src = chrome.runtime.getURL('icons/icon128.png')
      img.alt = 'Rtranslate'
      img.width = 22
      img.height = 22
      item.append(img)
    } else {
      item.append(el('span', 'ob-pin-emoji', row.icon))
    }
    item.append(el('span', 'ob-pin-text', row.text))
    steps.append(item)
  })
  section.append(steps)

  const actions = el('div', 'ob-actions')
  const prev = el('button', 'ob-btn ghost ob-prev', L('onboarding.prev', '上一步'))
  prev.type = 'button'
  prev.addEventListener('click', () => {
    step = 1
    render()
  })
  const next = el('button', 'ob-btn primary ob-next', L('onboarding.next', '下一步'))
  next.type = 'button'
  next.addEventListener('click', () => {
    step = 3
    render()
  })
  actions.append(buildSkipLink(), prev, next)
  section.append(actions)
  return section
}

// ===== Step 3：交互初体验 =====

function renderDemoResult(): void {
  if (!demoResultEl) return
  demoResultEl.className = 'ob-demo-result'
  if (demoState === 'done') demoResultEl.classList.add('is-done')
  if (demoState === 'error') demoResultEl.classList.add('is-error')
  if (demoState === 'idle') {
    demoResultEl.textContent = L(
      'onboarding.demo.idle',
      '选中示例文本后，译文会实时显示在这里',
    )
  } else if (demoState === 'loading') {
    demoResultEl.textContent = L('onboarding.demo.translating', '翻译中…')
  } else if (demoState === 'error') {
    demoResultEl.textContent = L('ob.s7', `${L('onboarding.demo.failed', '翻译失败：')}${demoText}`)
  } else {
    demoResultEl.textContent = demoText
  }
}

/** 选中示例文本 → 调 background 翻译并展示；清空选择 → 回到引导提示 */
function onSelectionChange(): void {
  // 过期模块实例（测试多次 boot 后旧根已脱离 DOM）不参与响应
  if (!config || !renderedRoot || !document.body.contains(renderedRoot)) return
  if (step !== 3 || completed) return
  const text = (window.getSelection()?.toString() ?? '').trim()
  if (!text) {
    if (lastSelection !== '') {
      lastSelection = ''
      demoState = 'idle'
      demoText = ''
      renderDemoResult()
    }
    return
  }
  if (text === lastSelection) return
  lastSelection = text
  void translateDemo(text.slice(0, 500))
}

async function translateDemo(text: string): Promise<void> {
  if (!config) return
  demoState = 'loading'
  demoText = ''
  renderDemoResult()
  try {
    const res = await sendBg<TranslateResult>({
      kind: 'translate',
      text,
      targetLang: config.general.targetLang,
    })
    demoState = 'done'
    demoText = res.text
  } catch (e) {
    demoState = 'error'
    demoText = errMsg(e)
  }
  renderDemoResult()
}

function buildStep3(): HTMLElement {
  const section = el('section', 'ob-step ob-step-3')

  section.append(
    el('h1', 'ob-step-title', L('onboarding.demo.title', '试试划词翻译')),
    el(
      'p',
      'ob-step-desc',
      L('onboarding.demo.hint', '选中上面这句话，体验划词翻译'),
    ),
  )

  section.append(el('p', 'ob-sample-text', SAMPLE_TEXT))

  demoResultEl = el('div', 'ob-demo-result')
  renderDemoResult()
  section.append(demoResultEl)

  const actions = el('div', 'ob-actions')
  const prev = el('button', 'ob-btn ghost ob-prev', L('onboarding.prev', '上一步'))
  prev.type = 'button'
  prev.addEventListener('click', () => {
    step = 2
    render()
  })
  const finish = el(
    'button',
    'ob-btn primary ob-finish',
    L('onboarding.finish', '完成设置，开始使用'),
  )
  finish.type = 'button'
  finish.addEventListener('click', () => {
    finish.disabled = true
    void onFinish()
  })
  actions.append(buildSkipLink(), prev, finish)
  section.append(actions)
  return section
}

/** 完成：写 onboardingCompleted:true → 显示完成态（写盘失败也进入完成态，不阻塞用户） */
async function onFinish(): Promise<void> {
  try {
    const next = await sendBg<Config>({ kind: 'setConfig', patch: { onboardingCompleted: true } })
    if (next) config = next
  } catch {
    // 忽略写盘失败，仍展示完成态
  }
  if (config) config = { ...config, onboardingCompleted: true }
  completed = true
  render()
}

// ===== 完成态 =====

function buildDone(): HTMLElement {
  const section = el('section', 'ob-step ob-done')
  const icon = el('div', 'ob-done-icon')
  icon.innerHTML = DONE_ICON_SVG
  section.append(
    icon,
    el('h1', 'ob-step-title ob-done-title', L('onboarding.done.title', '一切就绪！')),
    el(
      'p',
      'ob-step-desc ob-done-desc',
      L('onboarding.done.desc', '可以关闭此标签页，去任意英文网页试试。'),
    ),
  )
  return section
}

// ===== 渲染 =====

function render(): void {
  if (!config) return
  document.documentElement.lang = uiLang
  const shell = el('div', 'ob-shell')
  renderedRoot = shell
  const card = el('div', 'ob-card')
  card.append(buildProgress())
  if (completed) card.append(buildDone())
  else if (step === 1) card.append(buildStep1(config))
  else if (step === 2) card.append(buildStep2())
  else card.append(buildStep3())
  shell.append(card)
  app.replaceChildren(shell)
}

// ===== 启动 =====

async function boot(): Promise<void> {
  try {
    config = await sendBg<Config>({ kind: 'getConfig' })
    uiLang = resolveUiLang(config.uiLang)
  } catch (e) {
    // 配置未加载成功时无法得知 uiLang，按默认中文展示错误
    app.textContent = L('ob.s8', `${t('onboarding.loadFailed', 'zh-CN', '加载配置失败：')}${errMsg(e)}`)
    return
  }
  render()
}

// 设置页切换界面语言（storage tv:config_v1 变化）后按新语言重渲染
watchUiLang((next) => {
  if (next === uiLang) return
  uiLang = next
  render()
})

document.addEventListener('selectionchange', onSelectionChange)

void boot()
