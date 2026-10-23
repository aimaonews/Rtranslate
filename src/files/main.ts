/**
 * Rtranslate files — 文档翻译页（原生 TS，10 语言 UI）。
 *
 * 流程：选择/拖拽文件 → parser.parse 切片段 → 分批 translateBatch（每批 50 段或 1800 字符，
 * 并发 3，AbortController 可取消）→ 校订（可选，逐段编辑译文）→ parser.build 回写 →
 * Blob 下载（文件名加 _已翻译）。
 * 翻译失败的片段保留原文并在页面提示；全部失败则不提供下载。
 *
 * 校订（Post-Editing）：翻译完成后结果区出现"校订译文"卡片，打开"校订模式"开关后
 * 逐段显示原文 + 可编辑译文；编辑实时写回 translations Map，下载时以校订后的 Map
 * 调 parser.build 生成文件。切换开关不丢校订内容（状态在 Map 里，列表重渲染取值）；
 * 重新翻译会重置校订并提示。超过 PE_MAX_SEGMENTS 段时仅渲染前 200 段。
 *
 * i18n：UI 文案走 t(key, resolveUiLang(config.uiLang), 中文原文)，词条在
 * shared/i18n-pages.ts 注册；storage tv:config_v1 变化时按新语言重渲染。
 */
import { LANGS } from '../core/langs'
import type { BgRequest, BgResponse } from '../shared/protocol'
import type { Config } from '../shared/config'
import { fmt, resolveUiLang, t, type ResolvedLang } from '../shared/i18n'
// side-effect：注册 files.*/review.* 页面词条；同时取 watchUiLang 帮助函数
import { watchUiLang } from '../shared/i18n-pages'
import { parserFor, SUPPORTED_EXTS } from './parsers'
import type { DocParser, OutputMode, ParsedDoc } from './parsers/types'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const BATCH_MAX_TEXTS = 50
const BATCH_MAX_CHARS = 1800
const CONCURRENCY = 3
/** 校订列表最多渲染的段数（超出仅提示，不影响下载；导出始终用完整 translations） */
export const PE_MAX_SEGMENTS = 200

// ===== 消息封装 =====

async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) {
    throw new Error('background 未响应')
  }
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ===== i18n =====

/** 当前界面语言（zh-CN 为源语言；启动时由 getConfig 解析，storage 变化时更新） */
let uiLang: ResolvedLang = 'zh-CN'

/** 取当前界面语言文案 */
function L(key: string, zh: string): string {
  return t(key, uiLang, zh)
}

// ===== 状态 =====

interface RunState {
  file: File
  parser: DocParser
  doc?: ParsedDoc
  running: boolean
  controller?: AbortController
  /** 当前译文：机翻结果 + 校订编辑（下载时直接交给 parser.build） */
  translations?: Map<number, string>
  /** 机翻基线快照：与 translations 对比得出"已校订"段数（改回基线即取消校订标记） */
  baseline?: Map<number, string>
  /** 被校订修改过的段 id */
  edited: Set<number>
  /** 校订模式开关 */
  postEditOn: boolean
}

let state: RunState | null = null

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

let toastEl: HTMLElement
let toastTimer: number | undefined

function toast(msg: string): void {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ===== 页面构建 =====

let dropzone: HTMLElement
let fileInput: HTMLInputElement
let fileInfoEl: HTMLElement
let langSelect: HTMLSelectElement
let modeRadios: NodeListOf<HTMLInputElement>
let translateBtn: HTMLButtonElement
let cancelBtn: HTMLButtonElement
let downloadBtn: HTMLButtonElement
let progressWrap: HTMLElement
let progressBar: HTMLElement
let progressText: HTMLElement
let statusEl: HTMLElement
// 校订区
let peCard: HTMLElement
let peToggle: HTMLInputElement
let peCount: HTMLElement
let peHint: HTMLElement
let peList: HTMLElement
// 需随界面语言重渲染的静态文案节点
let brandNameEl: HTMLElement
let cardFileTitleEl: HTMLElement
let cardFileDescEl: HTMLElement
let dropzoneMainEl: HTMLElement
let dropzoneSubEl: HTMLElement
let dzBtnEl: HTMLButtonElement
let cardOptTitleEl: HTMLElement
let langLabelEl: HTMLElement
let modeLabelEl: HTMLElement
let cardRunTitleEl: HTMLElement
let cardRunDescEl: HTMLElement
let peTitleEl: HTMLElement
let peToggleTextEl: HTMLElement
let peDescEl: HTMLElement
/** 输出模式单选的 label/desc 节点（与 MODE_DEFS 同序） */
const modeEls: Array<{ label: HTMLElement; desc: HTMLElement }> = []
/** 布局是否已构建（watchUiLang 回调可能早于 init 完成，未构建时仅更新语言标记） */
let layoutReady = false

/** 输出模式选项（文案键 + 中文原文；radio 值即 OutputMode） */
const MODE_DEFS: ReadonlyArray<{
  value: OutputMode
  labelKey: string
  labelZh: string
  descKey: string
  descZh: string
}> = [
  {
    value: 'bilingual',
    labelKey: 'files.mode.bilingual',
    labelZh: '双语对照',
    descKey: 'files.mode.bilingual.desc',
    descZh: '原文与译文上下对照，便于校对',
  },
  {
    value: 'translationOnly',
    labelKey: 'files.mode.translationOnly',
    labelZh: '仅译文',
    descKey: 'files.mode.translationOnly.desc',
    descZh: '只保留译文，版式更干净',
  },
]

/** 上传区副标题（支持格式 + 大小上限，随界面语言重渲染） */
function dropzoneSubText(): string {
  return fmt(L('files.dropzone.sub', '支持 {exts}，单个文件不超过 {size}'), {
    exts: SUPPORTED_EXTS.map((e) => '.' + e).join(' / '),
    size: fmtSize(MAX_FILE_SIZE),
  })
}

/** 执行卡片说明（批大小/并发参数，随界面语言重渲染） */
function runDescText(): string {
  return fmt(
    L(
      'files.card.run.desc',
      '按片段批量翻译（每批 {texts} 段 / {chars} 字符，并发 {concurrency}），可随时取消',
    ),
    { texts: BATCH_MAX_TEXTS, chars: BATCH_MAX_CHARS, concurrency: CONCURRENCY },
  )
}

/** 上传区线性图标：上传箭头（40px，stroke 继承 .dropzone-icon 的 color: 品牌蓝） */
const DROPZONE_ICON_SVG =
  '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 26V10"/>' +
  '<path d="M12 18l8-8 8 8"/>' +
  '<path d="M8 30v2a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-2"/>' +
  '</svg>'

function getMode(): OutputMode {
  const checked = Array.from(modeRadios).find((r) => r.checked)
  return checked?.value === 'translationOnly' ? 'translationOnly' : 'bilingual'
}

function buildLayout(): void {
  const app = document.getElementById('app') as HTMLElement
  const layout = el('main', 'layout')

  // 品牌
  const brand = el('div', 'brand')
  brand.append(el('div', 'brand-logo', '译'))
  const brandText = el('div', 'brand-text')
  brandNameEl = el('div', 'brand-name', L('files.title', 'Rtranslate · 文档翻译'))
  brandText.append(brandNameEl)
  brandText.append(el('div', 'brand-sub', 'PDF / ePub / DOCX / HTML / JSON / TXT / Markdown / SRT / VTT / ASS'))
  brand.append(brandText)
  layout.append(brand)

  // ===== 卡片 1：文件选择 =====
  const cardFile = el('section', 'card')
  cardFileTitleEl = el('h2', 'card-title', L('files.card.file.title', '选择文件'))
  cardFile.append(cardFileTitleEl)
  cardFileDescEl = el(
    'p',
    'card-desc',
    L('files.card.file.desc', '文件只在本地处理，翻译请求经由扩展后台发送到当前配置的引擎'),
  )
  cardFile.append(cardFileDescEl)
  dropzone = el('div', 'dropzone')
  const dzIcon = el('div', 'dropzone-icon')
  dzIcon.innerHTML = DROPZONE_ICON_SVG
  dropzone.append(dzIcon)
  dropzoneMainEl = el('div', 'dropzone-main', L('files.dropzone.main', '拖拽文件到这里'))
  dropzone.append(dropzoneMainEl)
  dropzoneSubEl = el('div', 'dropzone-sub', dropzoneSubText())
  dropzone.append(dropzoneSubEl)
  dzBtnEl = el('button', 'dropzone-btn', L('files.dropzone.button', '点击选择文件'))
  dzBtnEl.type = 'button'
  dropzone.append(dzBtnEl)
  cardFile.append(dropzone)
  fileInput = el('input', 'file-hidden') as HTMLInputElement
  fileInput.type = 'file'
  fileInput.accept = SUPPORTED_EXTS.map((e) => '.' + e).join(',')
  cardFile.append(fileInput)
  fileInfoEl = el('div')
  cardFile.append(fileInfoEl)
  layout.append(cardFile)

  // ===== 卡片 2：翻译设置 =====
  const cardOpt = el('section', 'card')
  cardOptTitleEl = el('h2', 'card-title', L('files.card.settings.title', '翻译设置'))
  cardOpt.append(cardOptTitleEl)

  const langField = el('div', 'field')
  langLabelEl = el('span', 'field-label', L('files.field.targetLang', '目标语言'))
  langField.append(langLabelEl)
  langSelect = el('select', 'control') as HTMLSelectElement
  for (const l of LANGS) {
    if (l.code === 'auto') continue
    const opt = document.createElement('option')
    opt.value = l.code
    opt.textContent = `${l.zh}（${l.en}）`
    langSelect.append(opt)
  }
  langField.append(langSelect)
  cardOpt.append(langField)

  const modeField = el('div', 'field')
  modeLabelEl = el('span', 'field-label', L('files.field.outputMode', '输出模式'))
  modeField.append(modeLabelEl)
  const radioGroup = el('div', 'radio-group')
  modeEls.length = 0
  for (const m of MODE_DEFS) {
    const item = el('label', 'radio-item')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'tv-file-mode'
    radio.value = m.value
    if (m.value === 'bilingual') radio.checked = true
    const text = el('span', 'radio-text')
    const labelEl = el('span', 'radio-label', L(m.labelKey, m.labelZh))
    const descEl = el('span', 'radio-desc', L(m.descKey, m.descZh))
    text.append(labelEl, descEl)
    item.append(radio, text)
    radioGroup.append(item)
    modeEls.push({ label: labelEl, desc: descEl })
  }
  modeField.append(radioGroup)
  cardOpt.append(modeField)
  layout.append(cardOpt)

  // ===== 卡片 3：执行 =====
  const cardRun = el('section', 'card')
  cardRunTitleEl = el('h2', 'card-title', L('files.card.run.title', '开始翻译'))
  cardRun.append(cardRunTitleEl)
  cardRunDescEl = el('p', 'card-desc', runDescText())
  cardRun.append(cardRunDescEl)
  const actions = el('div', 'actions')
  translateBtn = el('button', 'btn', L('files.action.translate', '开始翻译')) as HTMLButtonElement
  translateBtn.disabled = true
  cancelBtn = el('button', 'btn btn-ghost', L('files.action.cancel', '取消')) as HTMLButtonElement
  cancelBtn.style.display = 'none'
  downloadBtn = el(
    'button',
    'btn btn-success',
    L('files.action.download', '下载译文'),
  ) as HTMLButtonElement
  downloadBtn.style.display = 'none'
  downloadBtn.type = 'button'
  actions.append(translateBtn, cancelBtn, downloadBtn)
  cardRun.append(actions)

  progressWrap = el('div', 'progress-wrap')
  progressWrap.style.display = 'none'
  const track = el('div', 'progress-track')
  progressBar = el('div', 'progress-bar')
  track.append(progressBar)
  progressWrap.append(track)
  progressText = el('div', 'progress-text', '0 / 0')
  progressWrap.append(progressText)
  cardRun.append(progressWrap)

  statusEl = el('div', 'status')
  cardRun.append(statusEl)
  layout.append(cardRun)

  // ===== 卡片 4：校订译文（翻译完成后显示；开关默认关，开时才渲染编辑列表） =====
  peCard = el('section', 'card pe-card')
  peCard.style.display = 'none'
  const peHead = el('div', 'pe-head')
  peTitleEl = el('h2', 'card-title', L('files.pe.title', '校订译文'))
  peHead.append(peTitleEl)
  const toggleLabel = el('label', 'pe-toggle-wrap')
  peToggle = el('input', 'switch') as HTMLInputElement
  peToggle.type = 'checkbox'
  peToggleTextEl = el('span', 'pe-toggle-text', L('files.pe.toggle', '校订模式'))
  toggleLabel.append(peToggle, peToggleTextEl)
  peHead.append(toggleLabel)
  peCard.append(peHead)
  peDescEl = el(
    'p',
    'card-desc',
    L('files.pe.desc', '逐段核对译文并直接修改，编辑自动保存；下载时将使用校订后的文本'),
  )
  peCard.append(peDescEl)
  const peMeta = el('div', 'pe-meta')
  peCount = el('span', 'pe-count')
  peHint = el(
    'span',
    'pe-hint',
    fmt(L('files.pe.limitHint', '仅显示前 {n} 段校订'), { n: PE_MAX_SEGMENTS }),
  )
  peHint.style.display = 'none'
  peMeta.append(peCount, peHint)
  peCard.append(peMeta)
  peList = el('div', 'pe-list')
  peList.style.display = 'none'
  peCard.append(peList)
  layout.append(peCard)

  app.append(layout)
  toastEl = el('div', 'toast')
  document.body.append(toastEl)

  modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="tv-file-mode"]')
  updatePeCount()
  layoutReady = true
}

// ===== 文件选择 =====

function renderFileInfo(): void {
  fileInfoEl.textContent = ''
  if (!state) return
  const info = el('div', 'file-info')
  info.append(el('span', 'file-info-name', state.file.name))
  info.append(el('span', 'file-info-meta', fmtSize(state.file.size)))
  const clear = el('button', 'file-clear', L('files.file.remove', '移除'))
  clear.addEventListener('click', () => {
    resetRun()
    fileInput.value = ''
  })
  info.append(clear)
  fileInfoEl.append(info)
}

function resetRun(): void {
  if (state?.running) state.controller?.abort()
  state = null
  translateBtn.disabled = true
  downloadBtn.style.display = 'none'
  progressWrap.style.display = 'none'
  setStatus('')
  // 校订区一并重置
  peCard.style.display = 'none'
  peList.textContent = ''
  peList.style.display = 'none'
  peHint.style.display = 'none'
  peToggle.checked = false
  renderFileInfo()
}

function pickFile(file: File): void {
  const parser = parserFor(file.name)
  if (!parser) {
    toast(L('files.toast.unsupported', '不支持的文件格式'))
    return
  }
  if (file.size > MAX_FILE_SIZE) {
    toast(
      fmt(L('files.toast.tooLarge', '文件超过 {max} 上限（当前 {size}）'), {
        max: fmtSize(MAX_FILE_SIZE),
        size: fmtSize(file.size),
      }),
    )
    return
  }
  if (state?.running) {
    toast(L('files.toast.running', '翻译进行中，请先取消'))
    return
  }
  resetRun()
  state = { file, parser, running: false, edited: new Set(), postEditOn: false }
  translateBtn.disabled = false
  downloadBtn.style.display = 'none'
  renderFileInfo()
}

function bindFileEvents(): void {
  dropzone.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) pickFile(f)
  })
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  })
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'))
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
    const f = e.dataTransfer?.files?.[0]
    if (f) pickFile(f)
  })
}

// ===== 校订（Post-Editing） =====

function peTotal(): number {
  return state?.doc?.segments.length ?? 0
}

function updatePeCount(): void {
  peCount.textContent = fmt(L('files.pe.count', '已校订 {edited} / 共 {total} 段'), {
    edited: state?.edited.size ?? 0,
    total: peTotal(),
  })
}

/** 翻译完成后调用：展示校订卡片并重置本轮校订 UI */
function showPostEdit(run: RunState): void {
  run.postEditOn = false
  peToggle.checked = false
  peList.textContent = ''
  peList.style.display = 'none'
  peHint.style.display = 'none'
  updatePeCount()
  peCard.style.display = ''
}

/**
 * 渲染校订列表（最多 PE_MAX_SEGMENTS 段）。
 * 译文一律从 translations Map 取值：开关来回切换时重渲染也不丢已校订内容；
 * 翻译失败（Map 缺失）的段以原文占位，同样可校订补齐。
 */
function renderPeList(): void {
  peList.textContent = ''
  const run = state
  if (!run?.doc || !run.translations) return
  const segs = run.doc.segments
  const limit = Math.min(segs.length, PE_MAX_SEGMENTS)
  const frag = document.createDocumentFragment()
  for (let i = 0; i < limit; i++) {
    const seg = segs[i]
    const row = el('div', 'pe-seg')
    row.append(el('div', 'pe-src', seg.text))
    const ta = el('textarea', 'pe-input') as HTMLTextAreaElement
    ta.value = run.translations.get(seg.id) ?? seg.text
    ta.rows = 2
    ta.setAttribute(
      'aria-label',
      fmt(L('files.pe.segLabel', '第 {n} 段译文校订'), { n: seg.id + 1 }),
    )
    ta.addEventListener('input', () => {
      const cur = state
      if (cur !== run || !cur.translations || !cur.baseline) return
      cur.translations.set(seg.id, ta.value)
      // 与机翻基线对比：不同才算"已校订"，改回基线则取消计数
      const base = cur.baseline.get(seg.id) ?? seg.text
      if (ta.value !== base) cur.edited.add(seg.id)
      else cur.edited.delete(seg.id)
      updatePeCount()
    })
    row.append(ta)
    frag.append(row)
  }
  peList.append(frag)
}

function setPostEdit(on: boolean): void {
  const run = state
  if (!run?.doc || !run.translations) {
    peToggle.checked = false
    return
  }
  run.postEditOn = on
  if (on) {
    renderPeList()
    peList.style.display = ''
    peHint.style.display = peTotal() > PE_MAX_SEGMENTS ? '' : 'none'
  } else {
    peList.style.display = 'none'
    peHint.style.display = 'none'
  }
}

/** 下载：以当前（可能已校订）的 translations 调 parser.build，生成并触发下载 */
async function downloadCurrent(): Promise<void> {
  const run = state
  if (!run?.doc || !run.translations || run.running) return
  downloadBtn.disabled = true
  setStatusT('files.status.building', '正在生成文件…')
  try {
    const built = await run.parser.build(run.doc, run.translations, getMode())
    if (state !== run) return // 生成期间用户移除了文件
    const url = URL.createObjectURL(built.blob)
    const a = el('a')
    a.href = url
    a.download = built.filename
    document.body.append(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    const note =
      run.edited.size > 0
        ? fmt(L('files.status.exportedNote', '，含 {n} 段校订'), { n: run.edited.size })
        : ''
    setStatusT('files.status.exported', '已导出 {file}{note}', 'ok', { file: built.filename, note })
  } catch (e) {
    if (state === run) setStatus(errMsg(e), 'error')
  } finally {
    if (state === run) downloadBtn.disabled = false
  }
}

// ===== 翻译执行 =====

interface Batch {
  ids: number[]
  texts: string[]
}

function makeBatches(doc: ParsedDoc): Batch[] {
  const batches: Batch[] = []
  let cur: Batch = { ids: [], texts: [] }
  let chars = 0
  for (const seg of doc.segments) {
    if (cur.ids.length > 0 && (cur.ids.length >= BATCH_MAX_TEXTS || chars + seg.text.length > BATCH_MAX_CHARS)) {
      batches.push(cur)
      cur = { ids: [], texts: [] }
      chars = 0
    }
    cur.ids.push(seg.id)
    cur.texts.push(seg.text)
    chars += seg.text.length
  }
  if (cur.ids.length > 0) batches.push(cur)
  return batches
}

/** 当前进度（界面语言切换时按新语言重渲染文案） */
let progressState: { done: number; total: number } | null = null

function renderProgress(): void {
  if (!progressState) return
  const { done, total } = progressState
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  progressBar.style.width = `${pct}%`
  progressText.textContent = fmt(L('files.progress', '已翻译 {done} / {total} 片段（{pct}%）'), {
    done,
    total,
    pct,
  })
}

function setProgress(done: number, total: number): void {
  progressState = { done, total }
  renderProgress()
}

/**
 * 状态栏当前内容：i18n 消息（key + 占位参数，随界面语言重渲染）
 * 或原始文本（引擎报错等，保持原文不随语言切换）。
 */
type StatusContent =
  | { kind: 'i18n'; key: string; zh: string; vars?: Record<string, string | number> }
  | { kind: 'raw'; text: string }
  | null

let statusContent: StatusContent = null
let statusKind: '' | 'error' | 'warn' | 'ok' = ''

function renderStatus(): void {
  if (statusContent === null) {
    statusEl.textContent = ''
  } else if (statusContent.kind === 'raw') {
    statusEl.textContent = statusContent.text
  } else {
    statusEl.textContent = fmt(L(statusContent.key, statusContent.zh), statusContent.vars ?? {})
  }
  statusEl.className = statusKind ? `status ${statusKind}` : 'status'
}

/** 原始文本状态（引擎报错等，不随界面语言重渲染）；空串清空状态栏 */
function setStatus(text: string, kind: '' | 'error' | 'warn' | 'ok' = ''): void {
  statusContent = text === '' ? null : { kind: 'raw', text }
  statusKind = kind
  renderStatus()
}

/** i18n 状态：随界面语言切换重渲染 */
function setStatusT(
  key: string,
  zh: string,
  kind: '' | 'error' | 'warn' | 'ok' = '',
  vars?: Record<string, string | number>,
): void {
  statusContent = { kind: 'i18n', key, zh, vars }
  statusKind = kind
  renderStatus()
}

/** 可取消的 sendBg：abort 后立即放弃等待（后台请求自然结束，结果被忽略） */
function sendBgWithAbort<T>(msg: BgRequest, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const onAbort = (): void => reject(new DOMException('已取消', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    sendBg<T>(msg).then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(new DOMException('已取消', 'AbortError'))
        else resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

async function runTranslation(): Promise<void> {
  if (!state || state.running) return
  const run = state
  const { file, parser } = run
  run.running = true
  const controller = new AbortController()
  run.controller = controller
  translateBtn.disabled = true
  cancelBtn.style.display = ''
  downloadBtn.style.display = 'none'
  progressWrap.style.display = ''
  // 重新翻译会重置校订：提前提示，并收起校订卡片
  if (run.edited.size > 0) toast(L('files.toast.peReset', '重新翻译将清空已校订内容'))
  peCard.style.display = 'none'
  setProgress(0, 0)
  setStatusT('files.status.parsing', '正在解析文件…')

  try {
    const buf = await file.arrayBuffer()
    const doc = await parser.parse(buf, file.name)
    if (state !== run) return // 解析期间用户移除了文件
    run.doc = doc
    const total = doc.segments.length
    if (total === 0) {
      setStatusT('files.error.empty', '文件中没有可翻译的文本', 'error')
      return
    }
    setProgress(0, total)
    setStatusT('files.status.translating', '正在翻译…')

    const targetLang = langSelect.value
    const translations = new Map<number, string>()
    const batches = makeBatches(doc)
    let done = 0
    let failed = 0
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < batches.length) {
        if (controller.signal.aborted) return
        const batch = batches[cursor]
        cursor++
        try {
          const outs = await sendBgWithAbort<string[]>(
            { kind: 'translateBatch', texts: batch.texts, targetLang },
            controller.signal,
          )
          for (let k = 0; k < batch.ids.length; k++) {
            const t = outs[k]
            if (typeof t === 'string' && t.trim() !== '') translations.set(batch.ids[k], t)
            else failed++
            done++
          }
        } catch (e) {
          if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
          // 整批失败：保留原文
          failed += batch.ids.length
          done += batch.ids.length
        }
        setProgress(done, total)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    if (controller.signal.aborted) {
      setStatusT('files.status.cancelledProgress', '已取消（已完成 {done} / {total} 片段）', 'warn', {
        done,
        total,
      })
      return
    }
    if (failed >= total) {
      setStatusT('files.status.allFailed', '翻译全部失败，请检查引擎配置后重试', 'error')
      return
    }

    // 翻译完成：进入"校订 + 下载"阶段。下载时才以校订后的 Map 调 parser.build，
    // 因此这里只保存结果与机翻基线，不预生成文件。
    run.translations = translations
    run.baseline = new Map(translations)
    run.edited = new Set()
    downloadBtn.style.display = ''
    showPostEdit(run)

    if (failed > 0) {
      setStatusT(
        'files.status.donePartial',
        '完成：{ok} 个片段已翻译，{failed} 个片段失败已保留原文',
        'warn',
        { ok: total - failed, failed },
      )
    } else {
      setStatusT('files.status.done', '翻译完成，共 {total} 个片段', 'ok', { total })
    }
    setProgress(total, total)
  } catch (e) {
    if (state !== run) return
    if (e instanceof DOMException && e.name === 'AbortError') {
      setStatusT('files.status.cancelled', '已取消', 'warn')
    } else {
      setStatus(errMsg(e), 'error')
    }
  } finally {
    run.running = false
    run.controller = undefined
    if (state === run) {
      translateBtn.disabled = false
      cancelBtn.style.display = 'none'
    }
  }
}

function bindRunEvents(): void {
  translateBtn.addEventListener('click', () => {
    void runTranslation()
  })
  cancelBtn.addEventListener('click', () => {
    state?.controller?.abort()
  })
  downloadBtn.addEventListener('click', () => {
    void downloadCurrent()
  })
  peToggle.addEventListener('change', () => {
    setPostEdit(peToggle.checked)
  })
}

// ===== 界面语言 =====

/** 按当前界面语言刷新全部常驻文案，并重绘动态区（文件信息/校订列表/进度/状态） */
function refreshTexts(): void {
  brandNameEl.textContent = L('files.title', 'Rtranslate · 文档翻译')
  cardFileTitleEl.textContent = L('files.card.file.title', '选择文件')
  cardFileDescEl.textContent = L(
    'files.card.file.desc',
    '文件只在本地处理，翻译请求经由扩展后台发送到当前配置的引擎',
  )
  dropzoneMainEl.textContent = L('files.dropzone.main', '拖拽文件到这里')
  dropzoneSubEl.textContent = dropzoneSubText()
  dzBtnEl.textContent = L('files.dropzone.button', '点击选择文件')
  cardOptTitleEl.textContent = L('files.card.settings.title', '翻译设置')
  langLabelEl.textContent = L('files.field.targetLang', '目标语言')
  modeLabelEl.textContent = L('files.field.outputMode', '输出模式')
  for (let i = 0; i < MODE_DEFS.length; i++) {
    const def = MODE_DEFS[i]
    const refs = modeEls[i]
    if (!refs) continue
    refs.label.textContent = L(def.labelKey, def.labelZh)
    refs.desc.textContent = L(def.descKey, def.descZh)
  }
  cardRunTitleEl.textContent = L('files.card.run.title', '开始翻译')
  cardRunDescEl.textContent = runDescText()
  translateBtn.textContent = L('files.action.translate', '开始翻译')
  cancelBtn.textContent = L('files.action.cancel', '取消')
  downloadBtn.textContent = L('files.action.download', '下载译文')
  peTitleEl.textContent = L('files.pe.title', '校订译文')
  peToggleTextEl.textContent = L('files.pe.toggle', '校订模式')
  peDescEl.textContent = L(
    'files.pe.desc',
    '逐段核对译文并直接修改，编辑自动保存；下载时将使用校订后的文本',
  )
  peHint.textContent = fmt(L('files.pe.limitHint', '仅显示前 {n} 段校订'), { n: PE_MAX_SEGMENTS })
  updatePeCount()
  renderFileInfo()
  if (state?.postEditOn) renderPeList()
  renderProgress()
  renderStatus()
}

// ===== 初始化 =====

async function init(): Promise<void> {
  buildLayout()
  bindFileEvents()
  bindRunEvents()
  // 先读界面语言，再以该语言重渲染文案；默认目标语言跟随全局配置
  try {
    const config = await sendBg<Config>({ kind: 'getConfig' })
    uiLang = resolveUiLang(config.uiLang)
    refreshTexts()
    const def = config.general.targetLang
    if (def && def !== 'auto') langSelect.value = def
  } catch {
    langSelect.value = 'zh-CN'
  }
}

/** 测试钩子：读取当前运行状态（仅供 tests/files 下的单元测试断言使用） */
export function __getStateForTest(): RunState | null {
  return state
}

// 设置页切换界面语言（storage tv:config_v1 变化）后按新语言重渲染
watchUiLang((next) => {
  if (next === uiLang) return
  uiLang = next
  if (layoutReady) refreshTexts()
})

// 仅在真实页面环境（存在 #app 挂载点）自动初始化；
// 测试环境先备好 DOM 与 chrome 桩再动态导入本模块，同样走这里完成初始化。
if (typeof document !== 'undefined' && document.getElementById('app')) {
  void init()
}
