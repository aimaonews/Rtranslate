/**
 * Rtranslate popup — 弹窗页逻辑（原生 TS，无框架，中文 UI）。
 *
 * 消息流：
 * - popup → background：chrome.runtime.sendMessage，响应统一为 {ok:true,data}|{ok:false,error}
 * - popup → content：先 chrome.tabs.query({active:true,currentWindow:true}) 取当前 tab，
 *   再 chrome.tabs.sendMessage；无 content 脚本（chrome://、商店页等）时视为“此页面不可用”。
 *
 * 配置写入：{kind:'setConfig',patch}（store 为浅合并，嵌套字段须整对象展开后传入）。
 * 目标语言 / 显示模式 / 译文样式 / 引擎变更后，另向当前 tab 发 {kind:'configChanged',config} 热同步。
 */
import { LANGS, COMMON_LANG_CODES, langName } from '../core/langs'
import { TRANSLATION_STYLES, getStyle } from '../core/styles'
import type { Config } from '../shared/config'
import { t } from '../shared/i18n'
import type {
  BgRequest,
  BgResponse,
  ContentRequest,
  PageStateResult,
  StatsResult,
} from '../shared/protocol'

// ===== 消息封装 =====

/** 发消息给 background，按 {ok,data}|{ok:false,error} 解包；失败抛错（绝不 reject 的约定由 background 保证） */
async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) {
    throw new Error('background 未响应')
  }
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/** 向当前 tab 的 content 脚本发消息；无响应 / 无 content 脚本时返回 null，绝不 reject */
async function sendToContent<T>(msg: ContentRequest): Promise<T | null> {
  const tab = await getActiveTab()
  if (tab?.id == null) return null
  try {
    return (await chrome.tabs.sendMessage(tab.id, msg)) as T
  } catch {
    return null
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function ignore(_e: unknown): undefined {
  return undefined
}

/** 文案模板插值：'已翻译 {n} 段' + {n:3} → '已翻译 3 段'（i18n t() 不带插值，在此补齐） */
function fmt(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (raw, k: string) =>
    k in vars ? String(vars[k]) : raw,
  )
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

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

// ===== 数据表 =====

// ===== 引擎选项 =====

export interface EngineOption {
  id: string
  name: string
  /** public/engine-icons/ 下的相对路径 */
  icon: string
}

/** 内置引擎（AI猫置顶）；旧单 custom 引擎保留配置兼容，但不再出现在下拉中 */
const BUILTIN_ENGINES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'aimao', name: 'AI猫' },
  { id: 'google', name: '谷歌免费' },
  { id: 'bing', name: '微软免费' },
  { id: 'mymemory', name: 'MyMemory 免费' },
  { id: 'deepl', name: 'DeepL' },
  { id: 'openai', name: 'OpenAI 兼容' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'claude', name: 'Claude (Anthropic)' },
  { id: 'gemini', name: 'Gemini (Google)' },
  { id: 'libretranslate', name: 'LibreTranslate' },
]

/** 引擎图标文件映射（构建后位于 dist/engine-icons/，引用走 chrome.runtime.getURL） */
export const ENGINE_ICON_FILES: Record<string, string> = {
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
export function engineIconFor(id: string): string {
  if (id.startsWith('custom:')) return ENGINE_ICON_FILES.custom
  return ENGINE_ICON_FILES[id] ?? ENGINE_ICON_FILES.custom
}

/** 引擎下拉选项：AI猫第一 + 内置引擎 + config.engine.customEngines（id 为 custom:<entryId>） */
export function getEngineOptions(cfg: Config): EngineOption[] {
  const options: EngineOption[] = BUILTIN_ENGINES.map((e) => ({ ...e, icon: engineIconFor(e.id) }))
  for (const entry of cfg.engine.customEngines) {
    options.push({ id: `custom:${entry.id}`, name: entry.name, icon: engineIconFor(`custom:${entry.id}`) })
  }
  return options
}

/** 16px 引擎图标；加载失败时隐藏（如图标文件缺失） */
function engineIconImg(icon: string): HTMLImageElement {
  const img = el('img', 'engine-icon')
  img.src = chrome.runtime.getURL(icon)
  img.alt = ''
  img.width = 16
  img.height = 16
  img.addEventListener('error', () => {
    img.style.display = 'none'
  })
  return img
}

/** 译文样式示意色块（kebab-case CSS 属性，背景/边框/字效） */
const SWATCH_CSS: Record<string, Record<string, string>> = {
  'soft-gray': { background: '#f2f3f5', color: '#7a8089' },
  plain: { border: '1px dashed #c9ccd4', color: '#3c414b' },
  bold: { 'font-weight': '700', color: '#181b22' },
  italic: { 'font-style': 'italic', color: '#3c414b' },
  'underline-dotted': { color: '#3c414b', 'border-bottom': '2px dotted #409eff' },
  'highlight-yellow': { background: '#fef08a', color: '#584e12' },
  'highlight-green': { background: '#bbf7d0', color: '#14532d' },
  card: {
    background: '#ffffff',
    border: '1px solid #d9dce4',
    'box-shadow': '0 1px 2px rgba(20,22,30,.12)',
  },
  rounded: { background: '#ecf5ff', 'border-radius': '6px', color: '#409eff' },
  quote: { background: '#ecf5ff', 'border-left': '3px solid #409eff', color: '#409eff' },
  gradient: { background: 'linear-gradient(135deg,#60a5fa,#a78bfa)', color: '#ffffff' },
  frosted: { background: 'rgba(64,158,255,.22)', 'backdrop-filter': 'blur(2px)', color: '#4338ca' },
}

function makeSwatch(styleId: string): HTMLSpanElement {
  const s = el('span', 'swatch', '译')
  const css = SWATCH_CSS[styleId] ?? SWATCH_CSS['soft-gray']
  if (css) {
    for (const [k, v] of Object.entries(css)) s.style.setProperty(k, v)
  }
  return s
}

// ===== 状态 =====

let config: Config

type PageStatus = 'loading' | 'unavailable' | PageStateResult
let pageStatus: PageStatus = 'loading'

let statusDot: HTMLSpanElement
let statusText: HTMLParagraphElement
let mainBtn: HTMLButtonElement
let statsText: HTMLSpanElement

// ===== 配置更新 =====

async function patchConfig(patch: Partial<Config>, syncToTab: boolean): Promise<void> {
  config = await sendBg<Config>({ kind: 'setConfig', patch })
  if (syncToTab) await sendToContent<unknown>({ kind: 'configChanged', config })
}

// ===== 头部 =====

function buildHeader(root: HTMLElement): void {
  const header = el('header', 'header')

  const logo = el('img', 'logo')
  logo.src = chrome.runtime.getURL('icons/icon48.png')
  logo.alt = 'Rtranslate'

  const title = el('span', 'title', 'Rtranslate')

  const gear = el('button', 'icon-btn')
  gear.type = 'button'
  gear.title = t('settings', config.uiLang, '设置')
  gear.setAttribute('aria-label', t('popup.openSettings', config.uiLang, '打开设置'))
  gear.innerHTML = GEAR_SVG
  gear.addEventListener('click', () => {
    void sendBg<null>({ kind: 'command', cmd: 'openOptions' }).catch(ignore)
  })

  header.append(logo, title, gear)
  root.append(header)
}

// ===== 状态区 =====

function buildStatus(root: HTMLElement): void {
  const card = el('section', 'status-card')
  const statusRow = el('div', 'status-row')
  statusDot = el('span', 'status-dot')
  statusDot.setAttribute('aria-hidden', 'true')
  statusText = el('p', 'status-text')
  statusRow.append(statusDot, statusText)
  mainBtn = el('button', 'main-btn')
  mainBtn.type = 'button'
  mainBtn.addEventListener('click', () => {
    void handleToggle()
  })
  card.append(statusRow, mainBtn)
  root.append(card)
}

async function handleToggle(): Promise<void> {
  if (pageStatus === 'loading' || pageStatus === 'unavailable') return
  mainBtn.disabled = true
  try {
    await sendBg<null>({ kind: 'command', cmd: 'togglePage' })
  } catch (e) {
    statusText.textContent = `${t('popup.opFailed', config.uiLang, '操作失败：')}${errMsg(e)}`
    mainBtn.disabled = false
    return
  }
  await refreshPageState()
}

async function refreshPageState(): Promise<void> {
  pageStatus = 'loading'
  renderStatus()
  const res = await sendToContent<PageStateResult>({ kind: 'pageState' })
  pageStatus = res ?? 'unavailable'
  currentHost = res?.host ?? ''
  renderStatus()
  renderSiteRules()
}

function renderStatus(): void {
  const active = pageStatus !== 'loading' && pageStatus !== 'unavailable' && pageStatus.active
  mainBtn.classList.toggle('is-active', active)
  statusDot.className = 'status-dot'
  if (pageStatus !== 'loading' && pageStatus !== 'unavailable' && pageStatus.active) {
    statusDot.classList.add(pageStatus.failedCount > 0 ? 'is-err' : 'is-ok')
  }

  const ui = config.uiLang
  if (pageStatus === 'loading') {
    statusText.textContent = t('popup.statusLoading', ui, '正在检测页面状态…')
    mainBtn.textContent = t('popup.translatePage', ui, '翻译此页')
    mainBtn.disabled = true
  } else if (pageStatus === 'unavailable') {
    statusText.textContent = t('popup.pageUnavailable', ui, '此页面不可用')
    mainBtn.textContent = t('popup.translatePage', ui, '翻译此页')
    mainBtn.disabled = true
  } else if (pageStatus.active) {
    statusText.textContent =
      pageStatus.failedCount > 0
        ? fmt(t('popup.statusTranslatedFail', ui, '已翻译 {n} 段 · 失败 {m} 段'), {
            n: pageStatus.translatedCount,
            m: pageStatus.failedCount,
          })
        : fmt(t('popup.statusTranslated', ui, '已翻译 {n} 段'), { n: pageStatus.translatedCount })
    mainBtn.textContent = t('popup.restorePage', ui, '恢复原文')
    mainBtn.disabled = false
  } else {
    statusText.textContent = t('popup.statusIdle', ui, '当前页面未翻译')
    mainBtn.textContent = t('popup.translatePage', ui, '翻译此页')
    mainBtn.disabled = false
  }
}

// ===== 控制区 =====

function buildRow(label: string, control: HTMLElement, key?: string): HTMLElement {
  const row = el('div', 'row')
  if (key) row.dataset.row = key
  row.append(el('span', 'row-label', label), control)
  return row
}

/**
 * 语言下拉（源/目标共用）：LANGS 全量，常用置顶（optgroup 分组，auto 在常用组首位）。
 * kind='source' 读写 config.general.sourceLang；kind='target' 读写 targetLang。变更均热同步当前 tab。
 */
function buildLangSelect(kind: 'source' | 'target'): HTMLSelectElement {
  const sel = el('select', 'control')
  sel.dataset.langKind = kind
  const ui = config.uiLang
  const nameLang = ui === 'en' ? 'en' : 'zh'
  const commonGroup = el('optgroup')
  commonGroup.label = t('popup.commonLangs', ui, '常用语言')
  const allGroup = el('optgroup')
  allGroup.label = t('popup.allLangs', ui, '全部语言')
  const commonSet = new Set<string>(COMMON_LANG_CODES)
  for (const l of LANGS) {
    const opt = el('option')
    opt.value = l.code
    opt.textContent = langName(l.code, nameLang)
    if (commonSet.has(l.code)) commonGroup.append(opt)
    else allGroup.append(opt)
  }
  sel.append(commonGroup, allGroup)
  const current = kind === 'source' ? config.general.sourceLang : config.general.targetLang
  sel.value = current
  if (sel.value !== current) {
    // 未知语言码：兜底展示原码，避免下拉空白
    const opt = el('option')
    opt.value = current
    opt.textContent = current
    commonGroup.append(opt)
    sel.value = current
  }
  sel.addEventListener('change', () => {
    const general =
      kind === 'source'
        ? { ...config.general, sourceLang: sel.value }
        : { ...config.general, targetLang: sel.value }
    void patchConfig({ general }, true).catch(ignore)
  })
  return sel
}

/** 语言对行：源语言 → 目标语言 双下拉并排（中间 → 符号），无行标签、占满整行 */
function buildLangPairRow(): HTMLElement {
  const row = el('div', 'row lang-pair-row')
  row.dataset.row = 'lang'
  const pair = el('div', 'lang-pair')
  pair.append(
    buildLangSelect('source'),
    el('span', 'lang-pair-arrow', '→'),
    buildLangSelect('target'),
  )
  row.append(pair)
  return row
}

/** 译文样式自定义下拉：12 种 TRANSLATION_STYLES，每项带小色块示意 */
function buildStyleSelect(): HTMLElement {
  const wrap = el('div', 'style-select')

  const btn = el('button', 'style-select-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'listbox')

  const list = el('ul', 'style-select-list')
  list.setAttribute('role', 'listbox')

  function renderButton(): void {
    btn.replaceChildren(
      makeSwatch(config.style.styleId),
      el('span', 'style-select-text', getStyle(config.style.styleId).name),
      el('span', 'caret'),
    )
  }

  function renderSelection(): void {
    for (const item of items) {
      const on = item.dataset.styleId === config.style.styleId
      item.classList.toggle('selected', on)
      item.setAttribute('aria-selected', String(on))
    }
  }

  const items: HTMLLIElement[] = []
  for (const style of TRANSLATION_STYLES) {
    const item = el('li', 'style-select-item')
    item.setAttribute('role', 'option')
    item.dataset.styleId = style.id
    item.append(makeSwatch(style.id), el('span', 'style-select-item-name', style.name))
    item.addEventListener('click', () => {
      close()
      void patchConfig({ style: { styleId: style.id } }, true)
        .then(() => {
          renderButton()
          renderSelection()
        })
        .catch(ignore)
    })
    items.push(item)
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

  renderButton()
  renderSelection()
  wrap.append(btn, list)
  return wrap
}

/** 翻译引擎自定义下拉：getEngineOptions(config)，每项 16px 图标 + 名称（原生 option 不支持图片） */
function buildEngineSelect(): HTMLElement {
  const options = getEngineOptions(config)
  if (!options.some((o) => o.id === config.engine.provider)) {
    // 配置中的引擎不在列表（如旧单 custom、已删除的自定义引擎）：兜底展示，避免空白
    options.push({
      id: config.engine.provider,
      name: config.engine.provider,
      icon: engineIconFor(config.engine.provider),
    })
  }

  const wrap = el('div', 'style-select')

  const btn = el('button', 'style-select-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'listbox')

  const list = el('ul', 'style-select-list')
  list.setAttribute('role', 'listbox')

  function current(): EngineOption {
    return options.find((o) => o.id === config.engine.provider) ?? options[0]
  }

  function renderButton(): void {
    const o = current()
    btn.replaceChildren(
      engineIconImg(o.icon),
      el('span', 'style-select-text', o.name),
      el('span', 'caret'),
    )
  }

  function renderSelection(): void {
    for (const item of items) {
      const on = item.dataset.engineId === config.engine.provider
      item.classList.toggle('selected', on)
      item.setAttribute('aria-selected', String(on))
    }
  }

  const items: HTMLLIElement[] = []
  for (const o of options) {
    const item = el('li', 'style-select-item')
    item.setAttribute('role', 'option')
    item.dataset.engineId = o.id
    item.append(engineIconImg(o.icon), el('span', 'style-select-item-name', o.name))
    item.addEventListener('click', () => {
      close()
      void patchConfig({ engine: { ...config.engine, provider: o.id } }, true)
        .then(() => {
          renderButton()
          renderSelection()
        })
        .catch(ignore)
    })
    items.push(item)
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

  renderButton()
  renderSelection()
  wrap.append(btn, list)
  return wrap
}

/** AI 专家自定义下拉：config.experts.list（名称 + 内置/自定义小标签），选中 experts.activeId */
function buildExpertSelect(): HTMLElement {
  const wrap = el('div', 'style-select')

  const btn = el('button', 'style-select-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'listbox')

  const list = el('ul', 'style-select-list')
  list.setAttribute('role', 'listbox')

  function currentName(): string {
    return (
      config.experts.list.find((e) => e.id === config.experts.activeId)?.name ??
      config.experts.activeId
    )
  }

  function renderButton(): void {
    btn.replaceChildren(el('span', 'style-select-text', currentName()), el('span', 'caret'))
  }

  function renderSelection(): void {
    for (const item of items) {
      const on = item.dataset.expertId === config.experts.activeId
      item.classList.toggle('selected', on)
      item.setAttribute('aria-selected', String(on))
    }
  }

  const items: HTMLLIElement[] = []
  for (const expert of config.experts.list) {
    const item = el('li', 'style-select-item')
    item.setAttribute('role', 'option')
    item.dataset.expertId = expert.id
    item.append(
      el('span', 'style-select-item-name', expert.name),
      el(
        'span',
        'expert-tag',
        expert.builtin
          ? t('popup.expertBuiltin', config.uiLang, '内置')
          : t('popup.expertCustom', config.uiLang, '自定义'),
      ),
    )
    item.addEventListener('click', () => {
      close()
      void patchConfig({ experts: { ...config.experts, activeId: expert.id } }, true)
        .then(() => {
          renderButton()
          renderSelection()
        })
        .catch(ignore)
    })
    items.push(item)
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

  renderButton()
  renderSelection()
  wrap.append(btn, list)
  return wrap
}

/** 开关行（悬停翻译 / 划词翻译 / 悬浮球 / 站点规则） */
function buildSwitchRow(
  label: string,
  on: boolean,
  onChange: (v: boolean) => void,
  key?: string,
): HTMLElement {
  const row = el('div', 'row')
  if (key) row.dataset.row = key
  row.append(el('span', 'row-label', label))

  const sw = el('button', 'switch')
  sw.type = 'button'
  sw.setAttribute('role', 'switch')
  sw.setAttribute('aria-label', label)
  sw.append(el('span', 'knob'))

  const set = (v: boolean): void => {
    sw.classList.toggle('on', v)
    sw.setAttribute('aria-checked', String(v))
  }
  set(on)

  sw.addEventListener('click', () => {
    if (sw.hasAttribute('disabled')) return
    const next = !sw.classList.contains('on')
    set(next)
    onChange(next)
  })

  row.append(sw)
  return row
}

// ===== 当前网站规则（总是翻译 / 永不翻译） =====

let currentHost = ''
let siteAlwaysRow: HTMLElement | null = null
let siteNeverRow: HTMLElement | null = null

function setRowDisabled(row: HTMLElement | null, disabled: boolean): void {
  if (!row) return
  row.classList.toggle('is-disabled', disabled)
  row.querySelector('button.switch')?.toggleAttribute('disabled', disabled)
}

function siteListIncludes(list: string[], host: string): boolean {
  return list.some((s) => host === s || host.endsWith('.' + s))
}

function renderSiteRules(): void {
  const usable = currentHost !== ''
  setRowDisabled(siteAlwaysRow, !usable)
  setRowDisabled(siteNeverRow, !usable)
  const hostLabel = document.querySelector('.site-host')
  if (hostLabel) {
    hostLabel.textContent = usable
      ? currentHost
      : t('popup.pageUnavailable', config.uiLang, '此页面不可用')
  }
  if (!usable) return
  const alwaysOn = siteListIncludes(config.general.autoTranslateSites, currentHost)
  const neverOn = siteListIncludes(config.general.neverTranslateSites, currentHost)
  siteAlwaysRow?.querySelector('button.switch')?.classList.toggle('on', alwaysOn)
  siteNeverRow?.querySelector('button.switch')?.classList.toggle('on', neverOn)
}

function toggleSiteRule(kind: 'always' | 'never', on: boolean): void {
  if (!currentHost) return
  const host = currentHost
  const g = config.general
  let auto = g.autoTranslateSites.filter((s) => !(host === s || host.endsWith('.' + s) || s.endsWith('.' + host)))
  let never = g.neverTranslateSites.filter((s) => !(host === s || host.endsWith('.' + s) || s.endsWith('.' + host)))
  if (on) {
    if (kind === 'always') auto = [...auto, host]
    else never = [...never, host]
  }
  void patchConfig(
    { general: { ...g, autoTranslateSites: auto, neverTranslateSites: never } },
    true,
  )
    .then(() => renderSiteRules())
    .catch(ignore)
  // 开启"总是翻译此网站"时立即翻译当前页
  if (kind === 'always' && on && pageStatus !== 'loading' && pageStatus !== 'unavailable' && !pageStatus.active) {
    void sendBg<null>({ kind: 'command', cmd: 'togglePage' })
      .then(() => refreshPageState())
      .catch(ignore)
  }
}

function buildControls(root: HTMLElement): void {
  const section = el('section', 'controls')
  const ui = config.uiLang

  // 1. 语言对：源语言 → 目标语言（双下拉并排）
  section.append(buildLangPairRow())

  // 2. 翻译引擎（自定义下拉 + 16px 图标，AI猫置顶）
  section.append(buildRow(t('popup.engine', ui, '翻译引擎'), buildEngineSelect(), 'engine'))

  // 3. AI 专家（自定义下拉，仅 AI 引擎生效）
  section.append(buildRow(t('popup.expert', ui, 'AI 专家'), buildExpertSelect(), 'expert'))

  // 4. 显示模式
  const modeSel = el('select', 'control')
  const MODES: ReadonlyArray<{ value: Config['general']['displayMode']; name: string }> = [
    { value: 'bilingual', name: t('popup.bilingual', ui, '双语对照') },
    { value: 'translationOnly', name: t('popup.translationOnly', ui, '仅译文') },
  ]
  for (const m of MODES) {
    const opt = el('option')
    opt.value = m.value
    opt.textContent = m.name
    modeSel.append(opt)
  }
  modeSel.value = config.general.displayMode
  modeSel.addEventListener('change', () => {
    void patchConfig(
      { general: { ...config.general, displayMode: modeSel.value as Config['general']['displayMode'] } },
      true,
    ).catch(ignore)
  })
  section.append(buildRow(t('popup.displayMode', ui, '显示模式'), modeSel, 'displayMode'))

  // 5. 译文样式（自定义下拉 + 小色块）
  section.append(buildRow(t('popup.style', ui, '译文样式'), buildStyleSelect(), 'style'))

  // 6-8. 开关：悬停翻译 / 划词翻译 / 悬浮球
  section.append(
    buildSwitchRow(
      t('popup.hover', ui, '悬停翻译'),
      config.hover.enabled,
      (on) => {
        void patchConfig({ hover: { ...config.hover, enabled: on } }, false).catch(ignore)
      },
      'hover',
    ),
    buildSwitchRow(
      t('popup.selection', ui, '划词翻译'),
      config.selection.enabled,
      (on) => {
        void patchConfig({ selection: { ...config.selection, enabled: on } }, false).catch(ignore)
      },
      'selection',
    ),
    buildSwitchRow(
      t('popup.floatingBall', ui, '悬浮球'),
      config.floatingBall.enabled,
      (on) => {
        void patchConfig({ floatingBall: { enabled: on } }, false).catch(ignore)
      },
      'floatingBall',
    ),
  )

  // 9. 当前网站规则（位置不变，垫底）
  const siteSection = el('div', 'site-rules')
  siteSection.append(
    el('div', 'site-rules-label', t('popup.currentSite', ui, '当前网站')),
    el('div', 'site-host', t('popup.pageUnavailable', ui, '此页面不可用')),
  )
  siteAlwaysRow = buildSwitchRow(t('popup.alwaysSite', ui, '总是翻译此网站'), false, (on) =>
    toggleSiteRule('always', on),
  )
  siteNeverRow = buildSwitchRow(t('popup.neverSite', ui, '永不翻译网站'), false, (on) =>
    toggleSiteRule('never', on),
  )
  siteSection.append(siteAlwaysRow, siteNeverRow)
  section.append(siteSection)

  root.append(section)
}

// ===== 底部 =====

function buildFooter(root: HTMLElement): void {
  const ui = config.uiLang
  const footer = el('footer', 'footer')
  statsText = el('span', 'stats-text', t('popup.statsEmpty', ui, '生词 — · 到期 —'))
  const tutorialLink = el('a', 'footer-link', t('popup.tutorial', ui, '使用教程'))
  tutorialLink.href = chrome.runtime.getURL('onboarding.html')
  tutorialLink.target = '_blank'
  tutorialLink.rel = 'noopener noreferrer'
  const filesBtn = el('button', 'review-btn', t('popup.files', ui, '文档翻译'))
  filesBtn.type = 'button'
  filesBtn.addEventListener('click', () => {
    void sendBg<null>({ kind: 'command', cmd: 'openFiles' }).catch(ignore)
  })
  const reviewBtn = el('button', 'review-btn', t('popup.review', ui, '开始复习'))
  reviewBtn.type = 'button'
  reviewBtn.addEventListener('click', () => {
    void sendBg<null>({ kind: 'command', cmd: 'openReview' }).catch(ignore)
  })
  footer.append(statsText, tutorialLink, filesBtn, reviewBtn)
  root.append(footer)
}

async function refreshStats(): Promise<void> {
  try {
    const s = await sendBg<StatsResult>({ kind: 'getStats' })
    statsText.textContent = fmt(t('popup.stats', config.uiLang, '生词 {w} · 到期 {d}'), {
      w: s.totalWords,
      d: s.dueCount,
    })
  } catch {
    statsText.textContent = t('popup.statsEmpty', config.uiLang, '生词 — · 到期 —')
  }
}

// ===== 入口 =====

export async function init(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) return

  try {
    config = await sendBg<Config>({ kind: 'getConfig' })
  } catch (e) {
    // 配置未加载成功时无法得知 uiLang，按默认中文展示
    app.textContent = `${t('popup.loadFailed', config?.uiLang ?? 'zh-CN', '加载配置失败：')}${errMsg(e)}`
    return
  }

  buildHeader(app)
  buildStatus(app)
  buildControls(app)
  buildFooter(app)

  renderStatus()
  void refreshPageState()
  void refreshStats()
}

// 测试环境（node，无 DOM）下仅做纯函数导入，不启动 UI
if (typeof document !== 'undefined') void init()
