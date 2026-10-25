/**
 * Rtranslate options — 设置页逻辑（原生 TS，无框架，中文 UI，左侧竖排标签页导航）。
 *
 * 消息流（与 background 全部走 chrome.runtime.sendMessage，响应统一 {ok,data}|{ok:false,error}）：
 * - 进入时 {kind:'getConfig'} 拉取配置渲染；
 * - 所有修改即时 {kind:'setConfig',patch}（store 为浅合并，嵌套对象必须整对象展开后传入）；
 * - 生词本 {kind:'getWords'} 拉取、{kind:'deleteWord',id} 删除、{kind:'saveWord'} 逐条导入；
 * - 每次保存成功后顶部显示轻提示「已保存」。
 */
import { LANGS, COMMON_LANG_CODES, langNative } from '../core/langs'
import { TRANSLATION_STYLES } from '../core/styles'
import type { Config, CustomEngine, GlossaryTerm } from '../shared/config'
import { fmt, t, resolveUiLang, UI_LANGS, type UiLangCode } from '../shared/i18n'
import '../shared/i18n-dicts'
import { genId } from '../shared/ids'
import type { BgRequest, BgResponse, TestEngineResult, WordItem } from '../shared/protocol'
import { renderExpertsTab } from './tabExperts'
import { renderGlossaryLibsTab } from './tabGlossaryLibs'
import { renderWritingTab } from './tabWriting'
import { renderTtsTab } from './tabTts'
import { renderHotkeysTab } from './tabHotkeys'
import { BUILTIN_ENGINES, engineName, engineDesc } from '../shared/engines'
import { styleName, previewGlyph } from '../shared/uiLabels'

// ===== 消息封装 =====

/** 发消息给 background，按 {ok,data}|{ok:false,error} 解包；失败抛错（background 保证绝不 reject） */
async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) {
    throw new Error(ot('opt.s1', 'background 未响应'))
  }
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ===== 状态 =====

let config: Config
/** 当前界面语言文案（zh-CN 回退原文；auto 先解析为浏览器语言） */
const ot = (key: string, zh: string): string => t(key, resolveUiLang(config.uiLang), zh)
let words: WordItem[] = []
let wordsLoaded = false
let activeTab: TabId = 'general'

let contentEl: HTMLElement
let toastEl: HTMLElement
let toastTimer: number | undefined

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

/** 传給 tab 子模块的宽签名版 el */
const elAny: (tag: string, cls?: string, text?: string) => HTMLElement = (tag, cls, text) =>
  el(tag as keyof HTMLElementTagNameMap, cls, text)

/** 卡片容器：标题 + 说明文案 */
function card(title: string, desc?: string): HTMLElement {
  const c = el('section', 'card')
  c.append(el('h2', 'card-title', title))
  if (desc) c.append(el('p', 'card-desc', desc))
  return c
}

/** 标准表单行：左标签 + 右控件 */
function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'field')
  row.append(el('span', 'field-label', label), control)
  return row
}

/** 占满整行的字段（textarea 用），标签在上控件在下 */
function fieldTop(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'field field-top')
  row.append(el('span', 'field-label', label), control)
  return row
}

/** 顶部轻提示 */
function showToast(text: string): void {
  if (!toastEl) return
  toastEl.textContent = text
  toastEl.classList.add('show')
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1400)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 域名归一化：去协议/www/路径，小写；非法输入返回空串 */
function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
}

// ===== 通用控件构建 =====

/** 原生滑动开关（checkbox 模拟） */
function buildSwitch(on: boolean, ariaLabel: string, onChange: (v: boolean) => void): HTMLInputElement {
  const input = el('input')
  input.type = 'checkbox'
  input.className = 'switch'
  input.checked = on
  input.setAttribute('aria-label', ariaLabel)
  input.addEventListener('change', () => onChange(input.checked))
  return input
}

/** 枚举下拉 */
function buildEnumSelect<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const sel = el('select', 'control')
  for (const o of options) {
    const opt = el('option')
    opt.value = o.value
    opt.textContent = o.label
    sel.append(opt)
  }
  sel.value = current
  sel.addEventListener('change', () => onChange(sel.value as T))
  return sel
}

/** 语言下拉：LANGS 全量，常用置顶（optgroup 分组）；表外语言码兜底追加避免空白 */
function buildLangSelect(
  current: string,
  opts: { excludeAuto?: boolean; onChange: (code: string) => void },
): HTMLSelectElement {
  const sel = el('select', 'control')
  const ui = resolveUiLang(config.uiLang)
  const commonGroup = el('optgroup')
  commonGroup.label = t('lang.commonGroup', ui, '常用语言')
  const allGroup = el('optgroup')
  allGroup.label = t('lang.allGroup', ui, '全部语言')
  const commonSet = new Set<string>(COMMON_LANG_CODES)
  for (const l of LANGS) {
    if (opts.excludeAuto && l.code === 'auto') continue
    const opt = el('option')
    opt.value = l.code
    opt.textContent = l.code === 'auto' ? t('lang.autoDetect', ui, '自动检测') : langNative(l.code)
    if (commonSet.has(l.code)) commonGroup.append(opt)
    else allGroup.append(opt)
  }
  sel.append(commonGroup, allGroup)
  sel.value = current
  if (sel.value !== current) {
    // 未知语言码：兜底展示原码
    const opt = el('option')
    opt.value = current
    opt.textContent = langNative(current)
    commonGroup.append(opt)
    sel.value = current
  }
  sel.addEventListener('change', () => opts.onChange(sel.value))
  return sel
}

/** radio 组（卡片式选项） */
function buildRadioGroup<T extends string>(
  name: string,
  options: ReadonlyArray<{ value: T; label: string; desc?: string }>,
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = el('div', 'radio-group')
  for (const opt of options) {
    const label = el('label', 'radio-item')
    const input = el('input')
    input.type = 'radio'
    input.name = name
    input.value = opt.value
    input.checked = opt.value === current
    const textWrap = el('span', 'radio-text')
    textWrap.append(el('span', 'radio-label', opt.label))
    if (opt.desc) textWrap.append(el('span', 'radio-desc', opt.desc))
    label.append(input, textWrap)
    input.addEventListener('change', () => {
      if (input.checked) onChange(opt.value)
    })
    wrap.append(label)
  }
  return wrap
}

/** 文本输入：change（失焦/回车）时提交 */
function buildTextInput(value: string, placeholder: string, onCommit: (v: string) => void): HTMLInputElement {
  const input = el('input', 'control')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.spellcheck = false
  input.addEventListener('change', () => onCommit(input.value.trim()))
  return input
}

/** 密钥输入：password + 显示/隐藏切换，change 时提交 */
function buildSecretInput(value: string, placeholder: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el('div', 'secret-wrap adder')
  const input = el('input', 'control')
  input.type = 'password'
  input.value = value
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.spellcheck = false
  const btn = el('button', 'btn btn-ghost', ot('opt.s2', '显示'))
  btn.type = 'button'
  btn.addEventListener('click', () => {
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    btn.textContent = show ? ot('opt.s3', '隐藏') : ot('opt.s2', '显示')
  })
  input.addEventListener('change', () => onCommit(input.value.trim()))
  wrap.append(input, btn)
  return wrap
}

/** JSON 多行输入：change 时提交原文（不做 trim，保留用户排版） */
function buildTextarea(value: string, rows: number, onCommit: (v: string) => void): HTMLTextAreaElement {
  const t = el('textarea', 'control')
  t.rows = rows
  t.value = value
  t.spellcheck = false
  t.addEventListener('change', () => onCommit(t.value))
  return t
}

/** 数字输入：change 时提交取整后的合法值 */
function buildNumberInput(value: number, min: number, onCommit: (v: number) => void): HTMLInputElement {
  const input = el('input', 'control control-num')
  input.type = 'number'
  input.min = String(min)
  input.value = String(value)
  input.addEventListener('change', () => {
    const n = Number(input.value)
    if (Number.isFinite(n) && n >= min) onCommit(Math.floor(n))
  })
  return input
}

/** 域名标签列表（可删除） */
function buildTagList(items: readonly string[], onRemove: (item: string) => void): HTMLElement {
  const wrap = el('div', 'tags')
  if (items.length === 0) {
    wrap.append(el('span', 'empty-inline', ot('opt.s4', '暂无')))
    return wrap
  }
  for (const item of items) {
    const tag = el('span', 'tag')
    tag.append(el('span', undefined, item))
    const btn = el('button', 'tag-x', '×')
    btn.type = 'button'
    btn.title = ot('opt.s5', '移除')
    btn.setAttribute('aria-label', fmt(ot('opt.s6', '移除 {p1}'), { p1: item }))
    btn.addEventListener('click', () => onRemove(item))
    tag.append(btn)
    wrap.append(tag)
  }
  return wrap
}

/** 域名添加条：输入框 + 添加按钮（支持回车） */
function buildDomainAdder(placeholder: string, onAdd: (domain: string) => void): HTMLElement {
  const wrap = el('div', 'adder')
  const input = el('input', 'control')
  input.type = 'text'
  input.placeholder = placeholder
  const btn = el('button', 'btn', ot('opt.s7', '添加'))
  btn.type = 'button'
  const submit = (): void => {
    const d = normalizeDomain(input.value)
    if (d) onAdd(d)
  }
  btn.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
  })
  wrap.append(input, btn)
  return wrap
}

// ===== 配置更新（所有修改即时保存） =====

/**
 * 商店合规（权限最小化）：自定义/自托管/代理端点指向任意域名，
 * 通过 optional_host_permissions 在用户操作时按需申请；内置默认端点
 * 已被 chrome.permissions.contains 视为已授予而自动跳过。
 */
async function ensureEndpointPermissions(patch: Partial<Config>): Promise<boolean> {
  const engine = { ...config.engine, ...patch.engine }
  // AI猫为内置服务（manifest 必需主机权限已覆盖），跳过；
  // 收集各自定义引擎 endpoint 与 openai/deepseek/libre 端点按需申请。
  const candidates = [
    ...engine.customEngines.map((e) => e.endpoint),
    engine.openai.endpoint,
    engine.deepseek.endpoint,
    engine.keys.libreUrl,
  ]
  const origins: string[] = []
  for (const u of candidates) {
    if (!u) continue
    try {
      const o = `${new URL(u).origin}/*`
      if (!origins.includes(o)) origins.push(o)
    } catch {
      /* 无效地址由运行时校验拦截 */
    }
  }
  for (const origin of origins) {
    if (await chrome.permissions.contains({ origins: [origin] })) continue
    const granted = await chrome.permissions.request({ origins: [origin] })
    if (!granted) {
      showToast(fmt(ot('opt.s8', '未授予 {p1} 访问权限，该接口将无法连通'), { p1: origin }))
      return false
    }
  }
  return true
}

async function patchConfig(patch: Partial<Config>): Promise<void> {
  try {
    if (!(await ensureEndpointPermissions(patch))) return
    config = await sendBg<Config>({ kind: 'setConfig', patch })
    showToast(ot('opt.s9', '已保存'))
  } catch (e) {
    showToast(fmt(ot('opt.s10', '保存失败：{p1}'), { p1: errMsg(e) }))
  }
  renderContent()
}

// ===== 标签页骨架 =====

const TABS = [
  { id: 'general', label: '通用' },
  { id: 'engine', label: '翻译引擎' },
  { id: 'experts', label: 'AI 专家' },
  { id: 'style', label: '译文样式' },
  { id: 'privacy', label: '隐私' },
  { id: 'glossary', label: '术语表' },
  { id: 'glossaryLibs', label: 'AI 术语库' },
  { id: 'writing', label: 'AI 写作' },
  { id: 'tts', label: '语音朗读' },
  { id: 'words', label: '生词本' },
  { id: 'interaction', label: '交互' },
  { id: 'hotkeys', label: '快捷键' },
] as const

type TabId = (typeof TABS)[number]['id']

/** 导航/页标题文案：随界面语言切换（auto 先解析为浏览器界面语言；zh-CN 时即 TABS 内的中文原文） */
function tabLabel(id: TabId, zh: string): string {
  return t(`tab.${id}`, resolveUiLang(config.uiLang), zh)
}

const TAB_DESCS: Record<TabId, string> = {
  general: '语言、显示模式与网站 / 语言名单',
  engine: '翻译引擎选择与密钥、批量、超时配置',
  experts: '自定义 AI 翻译策略（Prompt），仅对 AI 引擎生效',
  style: '译文在页面中的展示样式',
  privacy: '本地敏感信息脱敏与使用统计',
  glossary: '固定术语译法，保证翻译一致性',
  glossaryLibs: '领域术语库与智能提取，仅对 AI 引擎生效',
  writing: 'AI 写作助手的语气与篇幅偏好',
  tts: '朗读语速、音调与音量',
  hotkeys: '自定义全局快捷键',
  words: '收藏的生词，支持 JSON 导入导出',
  interaction: '悬停 / 划词 / 输入框翻译与悬浮球',
}

function buildShell(root: HTMLElement): void {
  const layout = el('div', 'layout')

  const sidebar = el('aside', 'sidebar')
  const brand = el('div', 'brand')
  const logo = el('img', 'brand-logo')
  logo.src = chrome.runtime.getURL('icons/icon48.png')
  logo.alt = ''
  const brandText = el('div', 'brand-text')
  brandText.append(el('span', 'brand-name', 'Rtranslate'), el('span', 'brand-sub', t('brand.settings', resolveUiLang(config.uiLang), '设置')))
  brand.append(logo, brandText)

  const nav = el('nav', 'nav')
  for (const tab of TABS) {
    const btn = el('button', 'nav-btn', tabLabel(tab.id, tab.label))
    btn.type = 'button'
    btn.dataset.tab = tab.id
    btn.addEventListener('click', () => switchTab(tab.id))
    nav.append(btn)
  }
  sidebar.append(brand, nav)

  const sideFooter = el('div', 'side-footer')
  const siteLink = el('a', 'side-footer-link', 'aimao.today')
  siteLink.href = 'https://www.aimao.today'
  siteLink.target = '_blank'
  siteLink.rel = 'noopener noreferrer'
  const guideLink = el('a', 'side-footer-link', t('nav.guide', config.uiLang, '重新打开引导页'))
  guideLink.href = chrome.runtime.getURL('onboarding.html')
  guideLink.target = '_blank'
  guideLink.rel = 'noopener noreferrer'
  const privacyLink = el('a', 'side-footer-link', t('nav.privacy', config.uiLang, '隐私政策'))
  privacyLink.href = chrome.runtime.getURL('privacy.html')
  privacyLink.target = '_blank'
  privacyLink.rel = 'noopener noreferrer'
  sideFooter.append(siteLink, guideLink, privacyLink)
  sidebar.append(sideFooter)

  const main = el('main', 'main')
  contentEl = el('div', 'content')
  main.append(contentEl)

  layout.append(sidebar, main)
  toastEl = el('div', 'toast')
  toastEl.setAttribute('role', 'status')
  root.append(layout, toastEl)
}

function switchTab(id: TabId): void {
  activeTab = id
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === id)
  })
  if (id === 'words' && !wordsLoaded) void loadWords()
  renderContent()
}

function renderContent(): void {
  if (!contentEl) return
  // 导航标签随界面语言刷新（uiLang 切换后重渲染即更新）
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
    const navTab = TABS.find((x) => x.id === b.dataset.tab)
    if (navTab) b.textContent = tabLabel(navTab.id, navTab.label)
  })
  contentEl.replaceChildren()
  const tab = TABS.find((x) => x.id === activeTab)
  contentEl.append(
    el('h1', 'page-title', tab ? tabLabel(tab.id, tab.label) : ''),
    el('p', 'page-desc', t(`tabDesc.${activeTab}`, resolveUiLang(config.uiLang), TAB_DESCS[activeTab])),
  )
  switch (activeTab) {
    case 'general':
      renderGeneral(contentEl)
      break
    case 'engine':
      renderEngine(contentEl)
      break
    case 'experts':
      renderExpertsTab(contentEl, { config, patchConfig, el: elAny })
      break
    case 'style':
      renderStyle(contentEl)
      break
    case 'privacy':
      renderPrivacy(contentEl)
      break
    case 'glossary':
      renderGlossary(contentEl)
      break
    case 'glossaryLibs':
      renderGlossaryLibsTab(contentEl, { config, patchConfig, el: elAny })
      break
    case 'writing':
      renderWritingTab(contentEl, { config, patchConfig, el })
      break
    case 'tts':
      renderTtsTab(contentEl, { config, patchConfig, el })
      break
    case 'words':
      renderWords(contentEl)
      break
    case 'interaction':
      renderInteraction(contentEl)
      break
    case 'hotkeys':
      renderHotkeysTab(contentEl, { config, patchConfig, el: elAny })
      break
  }
}

// ===== 标签页 1：通用 =====

function renderGeneral(root: HTMLElement): void {
  // 界面语言：auto 先解析为浏览器界面语言；t() 对 zh-CN 直接回退中文原文
  const L = resolveUiLang(config.uiLang)
  // 目标语言
  const langCard = card(
    t('general.targetLang', L, '目标语言'),
    t('general.targetLangDesc', L, '选择译文的目标语言，支持全部常用语言。'),
  )
  langCard.append(
    fieldRow(
      t('general.targetLang', L, '目标语言'),
      buildLangSelect(config.general.targetLang, {
        onChange: (code) => {
          void patchConfig({ general: { ...config.general, targetLang: code } })
        },
      }),
    ),
  )

  // 界面语言（扩展自身 UI 语言，与翻译目标语言无关；切换后 renderContent 即时重渲染）
  const uiLangCard = card(
    t('general.uiLang', L, '界面语言'),
    t('general.uiLangDesc', L, '界面语言影响扩展自身的显示语言，与翻译的目标语言无关'),
  )
  uiLangCard.append(
    fieldRow(
      t('general.uiLang', L, '界面语言'),
      buildEnumSelect<UiLangCode>(
        UI_LANGS.map((l) => ({
          value: l.code,
          // auto 项的显示名随当前界面语言本地化（跟随系统 / Follow system / …）
          label: l.code === 'auto' ? t('general.uiLangAuto', L, '跟随系统') : l.name,
        })),
        // 配置中的脏语言码兜底回退 auto，避免下拉空白
        (UI_LANGS.some((l) => l.code === config.uiLang) ? config.uiLang : 'auto') as UiLangCode,
        (v) => {
          void patchConfig({ uiLang: v })
        },
      ),
    ),
  )

  // 显示模式
  const modeCard = card(
    t('general.displayMode', L, '显示模式'),
    t('general.displayModeDesc', L, '控制译文与原文在页面中的呈现方式。'),
  )
  modeCard.append(
    buildRadioGroup(
      'displayMode',
      [
        {
          value: 'bilingual',
          label: t('general.bilingual', L, '双语对照'),
          desc: t('general.bilingualDesc', L, '保留原文，在其下方追加译文'),
        },
        {
          value: 'translationOnly',
          label: t('general.translationOnly', L, '仅译文'),
          desc: t('general.translationOnlyDesc', L, '隐藏原文，只显示译文'),
        },
      ],
      config.general.displayMode,
      (v) => {
        void patchConfig({ general: { ...config.general, displayMode: v } })
      },
    ),
  )

  // 总是翻译此网站
  const autoSiteCard = card(
    t('general.autoSites', L, '总是翻译此网站'),
    t('general.autoSitesDesc', L, '访问以下网站时自动开启整页翻译。'),
  )
  autoSiteCard.append(
    buildDomainAdder(t('general.domainPlaceholder', L, '输入域名，如 example.com'), (d) => {
      if (config.general.autoTranslateSites.includes(d)) return
      void patchConfig({
        general: { ...config.general, autoTranslateSites: [...config.general.autoTranslateSites, d] },
      })
    }),
    buildTagList(config.general.autoTranslateSites, (d) => {
      void patchConfig({
        general: {
          ...config.general,
          autoTranslateSites: config.general.autoTranslateSites.filter((s) => s !== d),
        },
      })
    }),
  )

  // 总是翻译该语言
  const autoLangCard = card(
    t('general.autoLangs', L, '总是翻译该语言'),
    t('general.autoLangsDesc', L, '检测到以下语言的页面时自动翻译，点击切换。'),
  )
  const chips = el('div', 'chips')
  for (const l of LANGS) {
    if (l.code === 'auto') continue
    const on = config.general.autoTranslateLangs.includes(l.code)
    const chip = el('button', 'chip' + (on ? ' on' : ''), langNative(l.code))
    chip.type = 'button'
    chip.addEventListener('click', () => {
      const cur = config.general.autoTranslateLangs
      const next = cur.includes(l.code) ? cur.filter((c) => c !== l.code) : [...cur, l.code]
      void patchConfig({ general: { ...config.general, autoTranslateLangs: next } })
    })
    chips.append(chip)
  }
  autoLangCard.append(chips)

  // 永不翻译网站
  const neverSiteCard = card(
    t('general.neverSites', L, '永不翻译网站'),
    t('general.neverSitesDesc', L, '以下网站永远不进行翻译。'),
  )
  neverSiteCard.append(
    buildDomainAdder(t('general.domainPlaceholder', L, '输入域名，如 example.com'), (d) => {
      if (config.general.neverTranslateSites.includes(d)) return
      void patchConfig({
        general: { ...config.general, neverTranslateSites: [...config.general.neverTranslateSites, d] },
      })
    }),
    buildTagList(config.general.neverTranslateSites, (d) => {
      void patchConfig({
        general: {
          ...config.general,
          neverTranslateSites: config.general.neverTranslateSites.filter((s) => s !== d),
        },
      })
    }),
  )

  root.append(langCard, uiLangCard, modeCard, autoSiteCard, autoLangCard, neverSiteCard)
}

// ===== 标签页 2：翻译引擎 =====

export interface EngineOption {
  id: string
  name: string
  desc: string
  /** public/engine-icons/ 下的相对路径；空串表示无图标 */
  icon: string
}

/** 引擎图标（构建后位于 dist/engine-icons/，引用走 chrome.runtime.getURL） */
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

/** 引擎下拉选项：AI猫第一 + 内置引擎 + config.engine.customEngines（id 为 custom:<entryId>） */
export function getEngineOptions(cfg: Config): EngineOption[] {
  const ui = resolveUiLang(cfg.uiLang)
  const options: EngineOption[] = BUILTIN_ENGINES.map((e) => ({
    id: e.id,
    name: engineName(e, ui),
    desc: engineDesc(e, ui),
    icon: ENGINE_ICON_FILES[e.id] ?? '',
  }))
  for (const entry of cfg.engine.customEngines) {
    options.push({
      id: `custom:${entry.id}`,
      name: entry.name,
      desc: entry.endpoint,
      icon: ENGINE_ICON_FILES.custom,
    })
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

/**
 * 带图标的引擎下拉（原生 option 不支持图片，用按钮 + 列表模拟）。
 * footerItem：列表底部追加的伪选项（如「＋ 添加自定义引擎」），选中同样走 onChange(id)。
 */
function buildEngineSelect(
  options: ReadonlyArray<EngineOption>,
  current: string,
  onChange: (id: string) => void,
  footerItem?: { id: string; label: string },
): HTMLElement {
  const wrap = el('div', 'engine-select')
  const btn = el('button', 'engine-select-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'listbox')
  const renderBtn = (): void => {
    const opt = options.find((o) => o.id === current)
    btn.replaceChildren()
    if (opt?.icon) btn.append(engineIconImg(opt.icon))
    const name = opt?.name ?? (footerItem && footerItem.id === current ? footerItem.label : current)
    btn.append(el('span', 'engine-select-name', name), el('span', 'engine-select-arrow', '▾'))
  }
  renderBtn()

  const list = el('div', 'engine-select-list')
  list.setAttribute('role', 'listbox')
  const close = (): void => list.classList.remove('open')
  btn.addEventListener('click', () => list.classList.toggle('open'))
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target as Node)) close()
  })
  for (const o of options) {
    const item = el('button', 'engine-select-item' + (o.id === current ? ' active' : ''))
    item.type = 'button'
    item.setAttribute('role', 'option')
    if (o.icon) item.append(engineIconImg(o.icon))
    item.append(el('span', 'engine-select-name', o.name))
    item.addEventListener('click', () => {
      close()
      onChange(o.id)
    })
    list.append(item)
  }
  if (footerItem) {
    const item = el('button', 'engine-select-item engine-select-add' + (footerItem.id === current ? ' active' : ''))
    item.type = 'button'
    item.setAttribute('role', 'option')
    item.append(el('span', 'engine-select-name', footerItem.label))
    item.addEventListener('click', () => {
      close()
      onChange(footerItem.id)
    })
    list.append(item)
  }
  wrap.append(btn, list)
  return wrap
}

/** 选择器底部「＋ 添加自定义引擎」伪选项 id（仅触发新建表单，不写入配置） */
const ADD_CUSTOM_ENGINE_ID = '__add_custom_engine__'

/** 新建自定义引擎表单的展开状态（跨 renderContent 保持；选中真实引擎 / 保存 / 取消后复位） */
let customEngineAdding = false

/**
 * 翻译引擎标签页：统一大卡片 = 引擎选择器 + 当前引擎配置区 + 连通性测试；
 * 自定义引擎（custom:<id>）的编辑/新建/删除也融入同一卡片，不再有独立管理卡片。
 */
function renderEngine(root: HTMLElement): void {
  const options = getEngineOptions(config)
  if (!options.some((o) => o.id === config.engine.provider)) {
    // 配置中的引擎不在列表（如旧单 custom 引擎、已删除的自定义引擎）：兜底展示，避免空白
    options.push({
      id: config.engine.provider,
      name: config.engine.provider,
      desc: '',
      icon: ENGINE_ICON_FILES.custom,
    })
  }
  const p = config.engine.provider
  const adding = customEngineAdding

  const c = card(ot('opt.s11', '引擎选择'), ot('opt.s12', '选择默认翻译引擎并完成其配置；免费引擎失败时自动降级到下一个免费引擎。'))
  c.append(
    fieldRow(
      ot('opt.s13', '引擎'),
      buildEngineSelect(
        options,
        adding ? ADD_CUSTOM_ENGINE_ID : p,
        (id) => {
          if (id === ADD_CUSTOM_ENGINE_ID) {
            // 伪选项：仅展开新建表单，不改动已保存的 provider
            customEngineAdding = true
            renderContent()
            return
          }
          customEngineAdding = false
          void patchConfig({ engine: { ...config.engine, provider: id } })
        },
        { id: ADD_CUSTOM_ENGINE_ID, label: ot('opt.s14', '＋ 添加自定义引擎') },
      ),
    ),
    el(
      'p',
      'engine-desc',
      adding ? ot('opt.s15', '填写新引擎信息，保存后自动设为当前翻译引擎。') : options.find((o) => o.id === p)?.desc ?? '',
    ),
  )

  // 配置区：选择器正下方、同卡片内，随引擎联动
  const configArea = el('div', 'engine-config')
  if (adding) {
    configArea.append(buildCustomEngineForm(null))
  } else {
    buildProviderConfig(configArea, p)
  }
  c.append(configArea)

  // 引擎连通性测试：用当前已保存配置翻译 "Hello"（background 复用 translate() 管线）
  const testBtn = el('button', 'btn btn-secondary', ot('opt.s16', '测试连接'))
  testBtn.type = 'button'
  const testResult = el('p', 'hint')
  testBtn.addEventListener('click', () => {
    if (testBtn.disabled) return // loading 态防重复点击
    testBtn.disabled = true
    testBtn.textContent = ot('opt.s17', '测试中…')
    testResult.textContent = ''
    void (async () => {
      try {
        const r = await sendBg<TestEngineResult>({ kind: 'testEngine' })
        if (r.ok) {
          testResult.style.color = 'var(--tv-success)'
          testResult.textContent = fmt(ot('opt.s18', '连接成功：Hello → {p1}（{p2}，{p3}ms）'), { p1: r.text ?? '', p2: r.engine, p3: r.elapsedMs })
        } else {
          testResult.style.color = 'var(--tv-danger-text)'
          testResult.textContent = fmt(ot('opt.s19', '连接失败：{p1}（{p2}ms）'), { p1: r.error ?? '未知错误', p2: r.elapsedMs })
        }
      } catch (e) {
        testResult.style.color = 'var(--tv-danger-text)'
        testResult.textContent = fmt(ot('opt.s20', '连接失败：{p1}'), { p1: errMsg(e) })
      } finally {
        testBtn.disabled = false
        testBtn.textContent = ot('opt.s16', '测试连接')
      }
    })()
  })
  // 请求超时并入引擎大卡片：分隔线之上为引擎配置，之下为超时与连通性测试
  c.append(
    el('hr', 'engine-divider'),
    fieldRow(ot('opt.s21', '超时（毫秒）'), buildNumberInput(config.engine.timeoutMs, 1000, (v) => {
      void patchConfig({ engine: { ...config.engine, timeoutMs: v } })
    })),
    fieldRow(ot('opt.s22', '连通性'), testBtn),
    testResult,
  )

  // 批量翻译
  const batchCard = card(ot('opt.s23', '批量翻译'), ot('opt.s24', 'LLM 类引擎将多个短句聚合为一次请求，显著降低请求数、提升速度。'))
  batchCard.append(
    fieldRow(ot('opt.s25', '启用批量翻译'), buildSwitch(config.batch.enabled, ot('opt.s23', '批量翻译'), (v) => {
      void patchConfig({ batch: { ...config.batch, enabled: v } })
    })),
    fieldRow(ot('opt.s26', '每批最大条数'), buildNumberInput(config.batch.maxTexts, 1, (v) => {
      void patchConfig({ batch: { ...config.batch, maxTexts: v } })
    })),
    fieldRow(ot('opt.s27', '每批最大字符数'), buildNumberInput(config.batch.maxChars, 100, (v) => {
      void patchConfig({ batch: { ...config.batch, maxChars: v } })
    })),
    fieldRow(ot('opt.s28', '聚合间隔（毫秒）'), buildNumberInput(config.batch.intervalMs, 10, (v) => {
      void patchConfig({ batch: { ...config.batch, intervalMs: v } })
    })),
  )

  root.append(c, batchCard)
}

/** 当前引擎的配置区内容（统一卡片内，选择器正下方）；custom:<id> 时显示该引擎的编辑表单 */
function buildProviderConfig(area: HTMLElement, p: string): void {
  if (p === 'aimao') {
    area.append(
      fieldRow('Endpoint', el('span', 'field-static', 'https://api.aimao.today/v1')),
      fieldRow(
        ot('opt.s29', '模型'),
        buildTextInput(config.engine.aimao.model, ot('opt.s30', '留空使用默认模型'), (v) => {
          void patchConfig({ engine: { ...config.engine, aimao: { ...config.engine.aimao, model: v } } })
        }),
      ),
    )
    // API Key + 右侧「获取API秘钥」外链
    const secret = buildSecretInput(config.engine.keys.aimao, t('engine.aimaoKeyPh', resolveUiLang(config.uiLang), '粘贴 aimao API Key'), (v) => {
      void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, aimao: v } } })
    })
    const keyLink = el('a', 'apikey-link', t('engine.getApiKey', resolveUiLang(config.uiLang), '获取 API 密钥'))
    keyLink.href = 'https://api.aimao.today/docs/'
    keyLink.target = '_blank'
    keyLink.rel = 'noopener noreferrer'
    secret.append(keyLink)
    area.append(fieldRow('API Key', secret))
  } else if (p === 'deepl') {
    area.append(
      el('p', 'hint', ot('opt.s31', '密钥仅保存在本机浏览器中。')),
      fieldRow(
        'API Key',
        buildSecretInput(config.engine.keys.deepl, ot('opt.s32', '粘贴 DeepL API Key'), (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, deepl: v } } })
        }),
      ),
    )
  } else if (p === 'openai') {
    area.append(
      fieldRow(
        'Endpoint',
        buildTextInput(config.engine.openai.endpoint, 'https://api.openai.com/v1', (v) => {
          void patchConfig({ engine: { ...config.engine, openai: { ...config.engine.openai, endpoint: v } } })
        }),
      ),
      fieldRow(
        ot('opt.s29', '模型'),
        buildTextInput(config.engine.openai.model, 'gpt-4o-mini', (v) => {
          void patchConfig({ engine: { ...config.engine, openai: { ...config.engine.openai, model: v } } })
        }),
      ),
      fieldRow(
        'API Key',
        buildSecretInput(config.engine.keys.openai, 'sk-...', (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, openai: v } } })
        }),
      ),
    )
  } else if (p === 'deepseek') {
    area.append(
      fieldRow(
        'Endpoint',
        buildTextInput(config.engine.deepseek.endpoint, 'https://api.deepseek.com/v1', (v) => {
          void patchConfig({ engine: { ...config.engine, deepseek: { ...config.engine.deepseek, endpoint: v } } })
        }),
      ),
      fieldRow(
        ot('opt.s29', '模型'),
        buildTextInput(config.engine.deepseek.model, 'deepseek-chat', (v) => {
          void patchConfig({ engine: { ...config.engine, deepseek: { ...config.engine.deepseek, model: v } } })
        }),
      ),
      fieldRow(
        'API Key',
        buildSecretInput(config.engine.keys.openai, ot('opt.s33', 'sk-...（与 OpenAI 兼容引擎共用此密钥框）'), (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, openai: v } } })
        }),
      ),
    )
  } else if (p === 'claude') {
    area.append(
      fieldRow(
        ot('opt.s29', '模型'),
        buildTextInput(config.engine.claude.model, 'claude-haiku-4-5-20251001', (v) => {
          void patchConfig({ engine: { ...config.engine, claude: { ...config.engine.claude, model: v } } })
        }),
      ),
      fieldRow(
        'API Key',
        buildSecretInput(config.engine.keys.claude, 'sk-ant-...', (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, claude: v } } })
        }),
      ),
    )
  } else if (p === 'gemini') {
    area.append(
      fieldRow(
        ot('opt.s29', '模型'),
        buildTextInput(config.engine.gemini.model, 'gemini-2.5-flash', (v) => {
          void patchConfig({ engine: { ...config.engine, gemini: { ...config.engine.gemini, model: v } } })
        }),
      ),
      fieldRow(
        'API Key',
        buildSecretInput(config.engine.keys.gemini, 'AIza...', (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, gemini: v } } })
        }),
      ),
    )
  } else if (p === 'libretranslate') {
    area.append(
      fieldRow(
        ot('opt.s34', '实例 URL'),
        buildTextInput(config.engine.keys.libreUrl, 'https://libretranslate.com', (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, libreUrl: v } } })
        }),
      ),
    )
  } else if (p.startsWith('custom:')) {
    const id = p.slice('custom:'.length)
    if (config.engine.customEngines.some((e) => e.id === id)) {
      // 选中自定义引擎：配置区直接显示该引擎的编辑表单（含删除入口）
      area.append(buildCustomEngineForm(id))
    } else {
      area.append(el('p', 'empty', ot('opt.s35', '该自定义引擎已被删除，请重新选择引擎。')))
    }
  } else if (p === 'custom') {
    // 旧单自定义引擎（兼容保留，不再出现在下拉中）
    area.append(
      fieldRow(
        ot('opt.s36', '接口 URL'),
        buildTextInput(config.engine.custom.url, 'https://example.com/translate', (v) => {
          void patchConfig({ engine: { ...config.engine, custom: { ...config.engine.custom, url: v } } })
        }),
      ),
      el('p', 'hint', ot('opt.s37', '请求体占位符：{{text}} 原文、{{from}} 源语言、{{to}} 目标语言，发送时按实际值替换。')),
      fieldTop(
        ot('opt.s38', '自定义请求体 JSON'),
        buildTextarea(config.engine.custom.bodyJson, 5, (v) => {
          void patchConfig({ engine: { ...config.engine, custom: { ...config.engine.custom, bodyJson: v } } })
        }),
      ),
      fieldTop(
        ot('opt.s39', '自定义请求头 JSON'),
        buildTextarea(config.engine.keys.customHeadersJson, 3, (v) => {
          void patchConfig({ engine: { ...config.engine, keys: { ...config.engine.keys, customHeadersJson: v } } })
        }),
      ),
      el('p', 'hint', ot('opt.s40', '请求头为 JSON 对象，如 {"Authorization":"Bearer xxx"}；留空则不附加。')),
    )
  } else {
    // google / bing / mymemory：免费引擎开箱即用
    area.append(el('p', 'empty', ot('opt.s41', '该引擎开箱即用，无需配置。')))
  }
}

// ===== 自定义引擎（OpenAI 兼容，可多实例） =====

/**
 * 自定义引擎新建/编辑表单：本地草稿（点保存/添加才 patchConfig），模板预填参考
 * DEFAULT_PROVIDER_CONFIG 思想；请求头 JSON 收进「高级设置（可选）」折叠区（陪读蛙同款
 * AdvancedFields 思路），默认收起、默认 '{}'。
 * - editId 为 null：新建模式（选择器底部「＋ 添加自定义引擎」触发），保存后自动设为当前引擎；
 * - editId 非空：编辑模式（选择器选中 custom:<id> 触发），表单内附「删除此引擎」。
 */
function buildCustomEngineForm(editId: string | null): HTMLElement {
  const editing = editId ? config.engine.customEngines.find((e) => e.id === editId) : undefined
  const form = el('div', 'custom-engine-form')

  const mkInput = (value: string, placeholder: string, type = 'text'): HTMLInputElement => {
    const input = el('input', 'control')
    input.type = type
    input.value = value
    input.placeholder = placeholder
    input.spellcheck = false
    input.autocomplete = 'off'
    return input
  }
  const nameInput = mkInput(editing?.name ?? ot('opt.s42', '我的引擎'), ot('opt.s43', '引擎名称'))
  const endpointInput = mkInput(editing?.endpoint ?? '', 'https://api.example.com/v1')
  const keyInput = mkInput(editing?.apiKey ?? '', 'sk-...', 'password')
  const modelInput = mkInput(editing?.model ?? '', ot('opt.s44', '模型名，如 gpt-4o-mini'))
  const headersInput = el('textarea', 'control')
  headersInput.rows = 2
  headersInput.value = editing?.headersJson ?? '{}'
  headersInput.spellcheck = false

  // 高级设置（可选）：请求头 JSON，<details> 默认收起
  const advanced = el('details', 'engine-advanced')
  const advancedBody = el('div', 'engine-advanced-body')
  advancedBody.append(
    fieldTop(ot('opt.s45', '请求头 JSON'), headersInput),
    el('p', 'hint', ot('opt.s46', '一般无需填写，仅当接口需要额外请求头时使用；JSON 对象，如 {"Authorization":"Bearer xxx"}。')),
  )
  advanced.append(el('summary', 'engine-advanced-summary', ot('opt.s47', '高级设置（可选）')), advancedBody)

  // 获取模型列表：GET {endpoint 去尾斜杠}/models，Authorization: Bearer，解析 data[].id
  const fetchBtn = el('button', 'btn btn-ghost', ot('opt.s48', '获取模型列表'))
  fetchBtn.type = 'button'
  const fetchHint = el('span', 'hint-inline')
  const modelRow = el('div', 'adder')
  modelRow.append(modelInput, fetchBtn)
  const modelPickWrap = el('div', 'model-pick-wrap')
  fetchBtn.addEventListener('click', () => {
    if (fetchBtn.disabled) return
    const endpoint = endpointInput.value.trim().replace(/\/+$/, '')
    if (!endpoint) {
      fetchHint.textContent = ot('opt.s49', '请先填写 Endpoint')
      return
    }
    fetchBtn.disabled = true
    fetchBtn.textContent = ot('opt.s50', '拉取中…')
    fetchHint.textContent = ''
    modelPickWrap.replaceChildren()
    void (async () => {
      try {
        const headers: Record<string, string> = {}
        const key = keyInput.value.trim()
        if (key) headers.Authorization = `Bearer ${key}`
        const resp = await fetch(`${endpoint}/models`, { headers })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = (await resp.json()) as { data?: Array<{ id?: unknown }> }
        const models = (Array.isArray(data.data) ? data.data : [])
          .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
          .filter((s) => s !== '')
        if (models.length === 0) throw new Error(ot('opt.s51', '接口未返回任何模型'))
        const sel = el('select', 'control')
        const placeholder = el('option')
        placeholder.value = ''
        placeholder.textContent = ot('opt.s52', '选择模型…')
        sel.append(placeholder)
        for (const m of models) {
          const opt = el('option')
          opt.value = m
          opt.textContent = m
          sel.append(opt)
        }
        sel.addEventListener('change', () => {
          if (sel.value) {
            modelInput.value = sel.value
            fetchHint.textContent = fmt(ot('opt.s53', '已选择 {p1}'), { p1: sel.value })
          }
        })
        modelPickWrap.append(sel)
        fetchHint.textContent = fmt(ot('opt.s54', '拉到 {p1} 个模型'), { p1: models.length })
      } catch (e) {
        fetchHint.textContent = fmt(ot('opt.s55', '获取模型列表失败：{p1}'), { p1: errMsg(e) })
      } finally {
        fetchBtn.disabled = false
        fetchBtn.textContent = ot('opt.s48', '获取模型列表')
      }
    })()
  })

  const formHint = el('p', 'hint')
  const saveBtn = el('button', 'btn', editing ? ot('opt.s56', '保存') : ot('opt.s7', '添加'))
  saveBtn.type = 'button'
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim()
    const endpoint = endpointInput.value.trim()
    if (!name || !endpoint) {
      formHint.textContent = ot('opt.s57', '名称与 Endpoint 必填')
      return
    }
    const headersJson = headersInput.value.trim() || '{}'
    try {
      JSON.parse(headersJson)
    } catch {
      formHint.textContent = ot('opt.s58', '请求头 JSON 格式不正确')
      return
    }
    const entry: CustomEngine = {
      id: editing?.id ?? genId(),
      name,
      endpoint,
      apiKey: keyInput.value.trim(),
      model: modelInput.value.trim(),
      headersJson,
    }
    if (editing) {
      const list = config.engine.customEngines.map((e) => (e.id === editing.id ? entry : e))
      void patchConfig({ engine: { ...config.engine, customEngines: list } })
    } else {
      // 新建保存后自动设为当前引擎
      customEngineAdding = false
      void patchConfig({
        engine: {
          ...config.engine,
          customEngines: [...config.engine.customEngines, entry],
          provider: `custom:${entry.id}`,
        },
      })
    }
  })

  const btnRow = el('div', 'toolbar')
  btnRow.append(saveBtn)
  if (editing) {
    // 删除此引擎；若删的是当前引擎，回退到 AI猫
    const delBtn = el('button', 'btn-link-danger', ot('opt.s59', '删除此引擎'))
    delBtn.type = 'button'
    delBtn.addEventListener('click', () => {
      const nextEngine = {
        ...config.engine,
        customEngines: config.engine.customEngines.filter((e) => e.id !== editing.id),
      }
      if (nextEngine.provider === `custom:${editing.id}`) nextEngine.provider = 'aimao'
      void patchConfig({ engine: nextEngine })
    })
    btnRow.append(delBtn)
  } else {
    const cancelBtn = el('button', 'btn btn-secondary', ot('opt.s60', '取消'))
    cancelBtn.type = 'button'
    cancelBtn.addEventListener('click', () => {
      customEngineAdding = false
      renderContent()
    })
    btnRow.append(cancelBtn)
  }

  form.append(
    fieldRow(ot('opt.s61', '名称'), nameInput),
    fieldRow('Endpoint', endpointInput),
    fieldRow('API Key', keyInput),
    fieldRow(ot('opt.s29', '模型'), modelRow),
    modelPickWrap,
    advanced,
    btnRow,
    formHint,
  )
  // fetchHint 与模型行同行展示
  modelRow.append(fetchHint)
  return form
}

// ===== 标签页 3：译文样式 =====

function renderStyle(root: HTMLElement): void {
  const c = card(ot('opt.s62', '样式选择'), ot('opt.s63', '选择译文在页面中的展示样式；大号「译」字为实时预览。'))
  const grid = el('div', 'style-grid')
  for (const s of TRANSLATION_STYLES) {
    const label = el('label', 'style-card' + (config.style.styleId === s.id ? ' selected' : ''))
    const input = el('input')
    input.type = 'radio'
    input.name = 'styleId'
    input.value = s.id
    input.checked = config.style.styleId === s.id
    // 预览：复用 content.css 的 tv-style-* 类名（同名样式在 style.css 中定义）
    const preview = el('div', 'style-preview')
    preview.append(el('span', s.className, previewGlyph(resolveUiLang(config.uiLang))))
    label.append(input, preview, el('div', 'style-name', styleName(s, resolveUiLang(config.uiLang))), el('div', 'style-name-en', s.nameEn))
    input.addEventListener('change', () => {
      if (input.checked) void patchConfig({ style: { styleId: s.id } })
    })
    grid.append(label)
  }
  c.append(grid)
  root.append(c)
}

// ===== 标签页 4：隐私 =====

function renderPrivacy(root: HTMLElement): void {
  // 与其他页一致：card(标题+说明) + fieldRow 行式开关（标签左+开关右），仅保留 card-mask 醒目底色
  const maskCard = card(
    ot('opt.s64', '敏感信息脱敏'),
    ot('opt.s65', '开启后，邮箱、电话、银行卡、身份证、API Key 等敏感信息将在本地打码为占位符后再发送翻译；译文返回后在本地还原，原文与敏感信息永不离开浏览器。全部处理在本机完成，默认关闭。'),
  )
  maskCard.classList.add('card-mask')
  maskCard.append(
    fieldRow(ot('opt.s66', '启用敏感信息脱敏'), buildSwitch(config.mask.enabled, ot('opt.s64', '敏感信息脱敏'), (v) => {
      void patchConfig({ mask: { enabled: v } })
    })),
  )

  const statsCard = card(ot('opt.s67', '使用统计'), ot('opt.s68', '本扩展无账号、无遥测，以下数据仅保存在本机。'))
  const row = el('div', 'field')
  row.append(el('span', 'field-label', ot('opt.s69', '已翻译字符数')), el('span', 'stat-value', config.stats.translatedChars.toLocaleString()))
  statsCard.append(row)

  root.append(maskCard, statsCard)
}

// ===== 标签页 5：术语表 =====

export interface GlossaryImportResult {
  terms: GlossaryTerm[]
  /** 跳过的坏行数（缺分隔符/缺列/重复；空行不计入） */
  skipped: number
}

/**
 * 解析批量导入文本：每行 `原文,译文`，分隔符按行自动识别（制表符 > 竖线 > 逗号）。
 * 空行忽略；缺分隔符或任一列为空的行计入 skipped；按 src 大小写不敏感去重（先出现者保留，重复行计入 skipped）。
 */
export function parseGlossaryImport(text: string): GlossaryImportResult {
  const terms: GlossaryTerm[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const sep = line.includes('\t') ? '\t' : line.includes('|') ? '|' : line.includes(',') ? ',' : null
    if (!sep) {
      skipped++
      continue
    }
    const parts = line.split(sep)
    const src = (parts[0] ?? '').trim()
    // 译文列允许再含分隔符（如逗号），合并剩余列
    const dst = parts.slice(1).join(sep).trim()
    if (!src || !dst) {
      skipped++
      continue
    }
    const key = src.toLowerCase()
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    terms.push({ src, dst })
  }
  return { terms, skipped }
}

/** 与现有术语表合并：按 src 大小写不敏感去重，已存在者以现有为准（不覆盖） */
export function mergeGlossaryTerms(
  existing: readonly GlossaryTerm[],
  imported: readonly GlossaryTerm[],
): GlossaryTerm[] {
  const seen = new Set(existing.map((t) => t.src.toLowerCase()))
  const merged = [...existing]
  for (const t of imported) {
    const key = t.src.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ src: t.src, dst: t.dst })
  }
  return merged
}

/** 批量导入面板的展开状态与上次导入结果（跨 renderContent 保持） */
let glossaryImportOpen = false
let glossaryImportMsg = ''

function renderGlossary(root: HTMLElement): void {
  const c = card(
    ot('opt.s70', '术语表'),
    ot('opt.s71', '共 %d 条术语。命中术语将以占位符保护并保证译法一致：发送翻译前术语被替换为占位符，返回后按本表还原。').replace(
      '%d',
      String(config.glossary.length),
    ),
  )

  if (config.glossary.length === 0) {
    c.append(el('p', 'empty', ot('opt.s72', '暂无术语，在下方添加。')))
  } else {
    const table = el('table', 'data-table')
    const thead = el('thead')
    const htr = el('tr')
    htr.append(el('th', undefined, ot('opt.s73', '原文')), el('th', undefined, ot('opt.s74', '译文')), el('th', undefined, ot('opt.s75', '操作')))
    thead.append(htr)
    const tbody = el('tbody')
    config.glossary.forEach((term, idx) => {
      const tr = el('tr')
      tr.append(el('td', undefined, term.src), el('td', undefined, term.dst))
      const opTd = el('td')
      const del = el('button', 'btn-link-danger', ot('opt.s76', '删除'))
      del.type = 'button'
      del.addEventListener('click', () => {
        void patchConfig({ glossary: config.glossary.filter((_, i) => i !== idx) })
      })
      opTd.append(del)
      tr.append(opTd)
      tbody.append(tr)
    })
    table.append(thead, tbody)
    c.append(table)
  }

  // 底部添加：原文 → 译文 + 添加按钮
  const addRow = el('div', 'glossary-add')
  const srcInput = el('input', 'control')
  srcInput.type = 'text'
  srcInput.placeholder = ot('opt.s77', '原文术语')
  const dstInput = el('input', 'control')
  dstInput.type = 'text'
  dstInput.placeholder = ot('opt.s74', '译文')
  const addBtn = el('button', 'btn', ot('opt.s7', '添加'))
  addBtn.type = 'button'
  const submit = (): void => {
    const src = srcInput.value.trim()
    const dst = dstInput.value.trim()
    if (!src || !dst) return
    void patchConfig({ glossary: [...config.glossary, { src, dst }] })
  }
  addBtn.addEventListener('click', submit)
  dstInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
  })
  addRow.append(srcInput, el('span', 'arrow', '→'), dstInput, addBtn)
  c.append(addRow)

  // 批量导入：粘贴文本或选择 .csv/.txt 文件，每行 `原文,译文`（支持逗号/制表符/竖线分隔）
  const importToggle = el('button', 'btn btn-secondary glossary-import-toggle', ot('opt.s78', '批量导入'))
  importToggle.type = 'button'
  importToggle.addEventListener('click', () => {
    glossaryImportOpen = !glossaryImportOpen
    renderContent()
  })
  c.append(importToggle)

  if (glossaryImportOpen) {
    const panel = el('div', 'glossary-import')
    const area = el('textarea', 'control')
    area.rows = 6
    area.placeholder = ot('opt.s79', '每行一条：原文,译文（也支持制表符或竖线分隔）')
    area.spellcheck = false

    const bar = el('div', 'glossary-import-bar')
    const fileLabel = el('label', 'btn btn-ghost', ot('opt.s80', '选择文件 (.csv/.txt)'))
    const fileInput = el('input')
    fileInput.type = 'file'
    fileInput.accept = '.csv,.txt,text/csv,text/plain'
    fileInput.className = 'file-hidden'
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      if (f) {
        void f.text().then((t) => {
          area.value = t
        })
      }
      fileInput.value = '' // 允许重复选择同一文件
    })
    fileLabel.append(fileInput)
    const importBtn = el('button', 'btn', ot('opt.s81', '导入'))
    importBtn.type = 'button'
    importBtn.addEventListener('click', () => {
      const { terms, skipped } = parseGlossaryImport(area.value)
      if (terms.length === 0) {
        glossaryImportMsg = skipped > 0 ? fmt(ot('opt.s82', '已导入 0 条，跳过 {p1} 行'), { p1: skipped }) : ot('opt.s83', '请先粘贴文本或选择文件')
        renderContent()
        return
      }
      const before = config.glossary.length
      const merged = mergeGlossaryTerms(config.glossary, terms)
      const added = merged.length - before
      const totalSkipped = skipped + (terms.length - added)
      glossaryImportMsg = fmt(ot('opt.s84', '已导入 {p1} 条，跳过 {p2} 行'), { p1: added, p2: totalSkipped })
      void patchConfig({ glossary: merged })
    })
    bar.append(fileLabel, importBtn)
    panel.append(area, bar)
    if (glossaryImportMsg) panel.append(el('p', 'hint', glossaryImportMsg))
    c.append(panel)
  }

  root.append(c)
}

// ===== 标签页 6：生词本 =====

function renderWords(root: HTMLElement): void {
  const c = card(ot('opt.s85', '生词本'), ot('opt.s86', '浏览、导出或导入收藏的生词；数据仅保存在本机浏览器中。'))

  // 工具条：导出 / 导入
  const toolbar = el('div', 'toolbar')
  const exportBtn = el('button', 'btn btn-secondary', ot('opt.s87', '导出 JSON'))
  exportBtn.type = 'button'
  exportBtn.disabled = words.length === 0
  exportBtn.addEventListener('click', exportWords)
  const importLabel = el('label', 'btn btn-secondary', ot('opt.s88', '导入 JSON'))
  const fileInput = el('input')
  fileInput.type = 'file'
  fileInput.accept = '.json,application/json'
  fileInput.className = 'file-hidden'
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) void importWords(f)
    fileInput.value = '' // 允许重复导入同一文件
  })
  importLabel.append(fileInput)
  toolbar.append(exportBtn, importLabel)
  c.append(toolbar)

  if (!wordsLoaded) {
    c.append(el('p', 'empty', ot('opt.s89', '加载中…')))
  } else if (words.length === 0) {
    c.append(el('p', 'empty', ot('opt.s90', '生词本为空，划词后点击「收藏」即可添加。')))
  } else {
    const table = el('table', 'data-table')
    const thead = el('thead')
    const htr = el('tr')
    for (const h of [ot('opt.s91', '单词'), ot('opt.s92', '释义'), ot('opt.s93', '上下文摘录'), ot('opt.s94', '来源'), ot('opt.s95', '创建时间'), ot('opt.s96', '遇到次数'), ot('opt.s97', '到期时间'), ot('opt.s75', '操作')]) {
      htr.append(el('th', undefined, h))
    }
    thead.append(htr)
    const tbody = el('tbody')
    const now = Date.now()
    for (const w of words) {
      const tr = el('tr')
      tr.append(el('td', 'word-cell', w.word))
      tr.append(el('td', undefined, w.translation && w.translation.trim() ? w.translation : '—'))
      const ctx = w.context && w.context.trim() ? (w.context.length > 40 ? `${w.context.slice(0, 40)}…` : w.context) : '—'
      tr.append(el('td', 'context-cell', ctx))
      const srcTd = el('td')
      if (w.pageUrl) {
        const link = el('a', 'word-source-link')
        link.href = w.pageUrl
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        try {
          link.textContent = w.pageTitle || new URL(w.pageUrl).hostname
        } catch {
          link.textContent = w.pageTitle || w.pageUrl.slice(0, 40)
        }
        srcTd.append(link)
      } else {
        srcTd.textContent = '—'
      }
      tr.append(srcTd)
      tr.append(el('td', undefined, fmtTime(w.createdAt)))
      tr.append(el('td', undefined, String(w.seenCount)))
      tr.append(el('td', undefined, w.card.due <= now ? ot('opt.s98', '已到期') : fmtTime(w.card.due)))
      const opTd = el('td')
      const del = el('button', 'btn-link-danger', ot('opt.s76', '删除'))
      del.type = 'button'
      del.addEventListener('click', () => {
        void removeWord(w.id)
      })
      opTd.append(del)
      tr.append(opTd)
      tbody.append(tr)
    }
    table.append(thead, tbody)
    c.append(table)
  }

  root.append(c)
}

async function loadWords(): Promise<void> {
  try {
    words = await sendBg<WordItem[]>({ kind: 'getWords' })
  } catch {
    words = []
  }
  wordsLoaded = true
  if (activeTab === 'words') renderContent()
}

async function removeWord(id: string): Promise<void> {
  try {
    await sendBg<null>({ kind: 'deleteWord', id })
    showToast(ot('opt.s99', '已删除'))
  } catch (e) {
    showToast(fmt(ot('opt.s100', '删除失败：{p1}'), { p1: errMsg(e) }))
  }
  wordsLoaded = false
  await loadWords()
}

function exportWords(): void {
  const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = el('a')
  a.href = url
  a.download = `transverse-words-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 导入校验：必须是数组，每项为含非空字符串 word 的对象；其余字段按类型容错 */
function parseWordsJson(text: string): { words: Array<{ word: string; context?: string; translation?: string }>; error?: undefined } | { words?: undefined; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: ot('opt.s101', '不是有效的 JSON 文件') }
  }
  if (!Array.isArray(parsed)) {
    return { error: ot('opt.s102', '应为生词数组') }
  }
  const valid: Array<{ word: string; context?: string; translation?: string }> = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    if (typeof o.word !== 'string' || !o.word.trim()) continue
    valid.push({
      word: o.word.trim(),
      context: typeof o.context === 'string' ? o.context : undefined,
      translation: typeof o.translation === 'string' ? o.translation : undefined,
    })
  }
  if (valid.length === 0) {
    return { error: ot('opt.s103', '未找到有效生词（每项需包含非空的 word 字段）') }
  }
  return { words: valid }
}

async function importWords(file: File): Promise<void> {
  const text = await file.text()
  const result = parseWordsJson(text)
  if (result.error || !result.words) {
    showToast(fmt(ot('opt.s104', '导入失败：{p1}'), { p1: result.error ?? '未知错误' }))
    return
  }
  let okCount = 0
  for (const w of result.words) {
    try {
      await sendBg<WordItem>({ kind: 'saveWord', word: w.word, context: w.context, translation: w.translation })
      okCount++
    } catch {
      // 单条失败跳过，继续导入其余
    }
  }
  showToast(fmt(ot('opt.s105', '已导入 {p1} 条生词'), { p1: okCount }))
  wordsLoaded = false
  await loadWords()
}

// ===== 标签页 7：交互 =====

function renderInteraction(root: HTMLElement): void {
  // 悬停翻译
  const hoverCard = card(ot('opt.s106', '悬停翻译'), ot('opt.s107', '按住修饰键并将鼠标悬停在段落上，即可只翻译该段。'))
  hoverCard.append(
    fieldRow(ot('opt.s108', '启用悬停翻译'), buildSwitch(config.hover.enabled, ot('opt.s106', '悬停翻译'), (v) => {
      void patchConfig({ hover: { ...config.hover, enabled: v } })
    })),
    fieldRow(
      ot('opt.s109', '修饰键'),
      buildEnumSelect(
        [
          { value: 'alt', label: 'Alt' },
          { value: 'ctrl', label: 'Ctrl' },
          { value: 'shift', label: 'Shift' },
          { value: 'none', label: ot('opt.s110', '直接悬停（无需按键）') },
        ],
        config.hover.key,
        (v) => {
          void patchConfig({ hover: { ...config.hover, key: v } })
        },
      ),
    ),
  )

  // 划词翻译
  const selCard = card(ot('opt.s111', '划词翻译'), ot('opt.s112', '选中文字后弹出气泡，可查看译文、AI 解析并收藏生词。'))
  selCard.append(
    fieldRow(ot('opt.s113', '启用划词翻译'), buildSwitch(config.selection.enabled, ot('opt.s111', '划词翻译'), (v) => {
      void patchConfig({ selection: { ...config.selection, enabled: v } })
    })),
    fieldRow(
      ot('opt.s114', '显示模式'),
      buildRadioGroup(
        'selectionMode',
        [
          { value: 'bilingual', label: ot('opt.s115', '双语对照'), desc: ot('opt.s116', '同时展示原文与译文') },
          { value: 'translationOnly', label: ot('opt.s117', '仅译文'), desc: ot('opt.s118', '气泡中只显示译文') },
        ],
        config.selection.mode,
        (v) => {
          void patchConfig({ selection: { ...config.selection, mode: v } })
        },
      ),
    ),
  )

  // 输入框翻译
  const inputCard = card(ot('opt.s119', '输入框翻译'), ot('opt.s120', '在输入框 / 文本域中触发翻译，译文仅供参考，不会自动替换你的输入。'))
  inputCard.append(
    fieldRow(ot('opt.s121', '启用输入框翻译'), buildSwitch(config.input.enabled, ot('opt.s119', '输入框翻译'), (v) => {
      void patchConfig({ input: { ...config.input, enabled: v } })
    })),
    fieldRow(
      ot('opt.s122', '触发方式'),
      buildRadioGroup(
        'inputTrigger',
        [
          { value: 'altEnter', label: 'Alt + Enter', desc: ot('opt.s123', '在输入框中按 Alt+Enter 立即翻译') },
          { value: 'tripleSpace', label: ot('opt.s124', '三连空格'), desc: ot('opt.s125', '连续输入三个空格自动翻译') },
        ],
        config.input.trigger,
        (v) => {
          void patchConfig({ input: { ...config.input, trigger: v } })
        },
      ),
    ),
    fieldRow(
      ot('opt.s126', '输入框目标语言'),
      buildLangSelect(config.input.targetLang, {
        excludeAuto: true,
        onChange: (code) => {
          void patchConfig({ input: { ...config.input, targetLang: code } })
        },
      }),
    ),
  )

  // 悬浮球
  const ballCard = card(ot('opt.s127', '悬浮球'), ot('opt.s128', '在页面右下角显示悬浮球，点击即可快速开关整页翻译。'))
  ballCard.append(
    fieldRow(ot('opt.s129', '启用悬浮球'), buildSwitch(config.floatingBall.enabled, ot('opt.s127', '悬浮球'), (v) => {
      void patchConfig({ floatingBall: { enabled: v } })
    })),
  )

  // 视频与会议字幕
  const subCard = card(
    ot('opt.s130', '视频与会议字幕翻译'),
    ot('opt.s131', 'YouTube 双语字幕；Google Meet / Teams / Zoom 会议实时字幕翻译。'),
  )
  subCard.append(
    fieldRow(ot('opt.s132', '启用字幕翻译'), buildSwitch(config.subtitles.enabled, ot('opt.s133', '字幕翻译'), (v) => {
      void patchConfig({ subtitles: { ...config.subtitles, enabled: v } })
    })),
    fieldRow(ot('opt.s134', 'YouTube 双语字幕'), buildSwitch(config.subtitles.youtube, ot('opt.s135', 'YouTube 字幕'), (v) => {
      void patchConfig({ subtitles: { ...config.subtitles, youtube: v } })
    })),
    fieldRow(ot('opt.s136', '会议字幕（Meet/Teams/Zoom）'), buildSwitch(config.subtitles.meet, ot('opt.s137', '会议字幕'), (v) => {
      void patchConfig({ subtitles: { ...config.subtitles, meet: v } })
    })),
  )

  root.append(hoverCard, selCard, inputCard, ballCard, subCard)
}

// ===== 入口 =====

async function init(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) return
  // 支持 URL 参数 ?uiLang=xx 覆盖界面语言（商店截图 / 测试用）
  const urlLang = new URLSearchParams(location.search).get('uiLang')
  try {
    config = await sendBg<Config>({ kind: 'getConfig' })
    if (urlLang && UI_LANGS.some((l) => l.code === urlLang)) config.uiLang = urlLang as Config['uiLang']
  } catch (e) {
    app.textContent = fmt(ot('opt.s138', '加载配置失败：{p1}'), { p1: errMsg(e) })
    return
  }
  buildShell(app)
  switchTab('general')
}

// 仅在浏览器环境启动（node 测试导入时不执行，避免触碰 document/chrome）
if (typeof document !== 'undefined') {
  void init()
}
