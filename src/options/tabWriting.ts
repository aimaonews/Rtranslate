/**
 * options/tabWriting.ts — 设置页「AI 写作」标签页模块。
 *
 * 由 options/main.ts 接线调用：renderWritingTab(contentEl, { config, patchConfig, el })。
 * 内容：AI 写作开关 + 默认语气/篇幅 + 功能说明卡片；全部复用 style.css 现有类名。
 *
 * 注意：config.writing 目前只有 enabled 字段（shared/* 由主代理维护），
 * 默认语气/篇幅暂存 chrome.storage.local 的 WRITING_PREFS_KEY，
 * content/selection.ts 的写作面板读取同一键作为初始值。
 */
import type { Config } from '../shared/config'
import { t, resolveUiLang } from '../shared/i18n'

/** 与 content/selection.ts 共享的存储键（默认语气/篇幅）。 */
export const WRITING_PREFS_KEY = 'tv:writing_prefs_v1'

export interface WritingPrefs {
  tone: string
  length: string
}

export interface WritingTabCtx {
  config: Config
  patchConfig: (patch: Partial<Config>) => void
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
  ) => HTMLElementTagNameMap[K]
}


/** 原生滑动开关（与 main.ts 的 buildSwitch 同款，本地实现避免跨模块依赖）。 */
function buildSwitch(
  ctx: WritingTabCtx,
  on: boolean,
  ariaLabel: string,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const input = ctx.el('input')
  input.type = 'checkbox'
  input.className = 'switch'
  input.checked = on
  input.setAttribute('aria-label', ariaLabel)
  input.addEventListener('change', () => onChange(input.checked))
  return input
}

/** 枚举下拉（control 类）。 */
function buildEnumSelect(
  ctx: WritingTabCtx,
  options: ReadonlyArray<{ value: string; label: string }>,
  current: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = ctx.el('select', 'control')
  for (const o of options) {
    const opt = ctx.el('option')
    opt.value = o.value
    opt.textContent = o.label
    sel.append(opt)
  }
  sel.value = current
  sel.addEventListener('change', () => onChange(sel.value))
  return sel
}

/** 卡片容器：标题 + 说明文案（与 main.ts 的 card() 同款）。 */
function card(ctx: WritingTabCtx, title: string, desc?: string): HTMLElement {
  const c = ctx.el('section', 'card')
  c.append(ctx.el('h2', 'card-title', title))
  if (desc) c.append(ctx.el('p', 'card-desc', desc))
  return c
}

/** 标准表单行：左标签 + 右控件。 */
function fieldRow(ctx: WritingTabCtx, label: string, control: HTMLElement): HTMLElement {
  const row = ctx.el('div', 'field')
  row.append(ctx.el('span', 'field-label', label), control)
  return row
}

function loadPrefs(cb: (prefs: WritingPrefs) => void): void {
  const fallback: WritingPrefs = { tone: 'default', length: 'default' }
  try {
    chrome.storage.local.get(WRITING_PREFS_KEY, (res) => {
      if (chrome.runtime.lastError) return cb(fallback)
      const raw = res?.[WRITING_PREFS_KEY] as Partial<WritingPrefs> | undefined
      cb({
        tone: typeof raw?.tone === 'string' ? raw.tone : 'default',
        length: typeof raw?.length === 'string' ? raw.length : 'default',
      })
    })
  } catch {
    cb(fallback)
  }
}

function savePrefs(prefs: WritingPrefs): void {
  try {
    void chrome.storage.local.set({ [WRITING_PREFS_KEY]: prefs })
  } catch {
    // storage 不可用时静默忽略（偏好非关键数据）
  }
}

export function renderWritingTab(root: HTMLElement, ctx: WritingTabCtx): void {
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)

  const TONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'default', label: ot('opt.writing.s1', '默认') },
    { value: 'formal', label: ot('opt.writing.s2', '正式') },
    { value: 'casual', label: ot('opt.writing.s3', '随意') },
    { value: 'humorous', label: ot('opt.writing.s4', '幽默') },
    { value: 'professional', label: ot('opt.writing.s5', '专业') },
  ]

  const LENGTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'default', label: ot('opt.writing.s1', '默认') },
    { value: 'shorter', label: ot('opt.writing.s6', '更短') },
    { value: 'longer', label: ot('opt.writing.s7', '更长') },
  ]
  const { config, patchConfig, el } = ctx

  // ===== 卡片 1：开关 =====
  const head = el('div', 'mask-head')
  const headTexts = el('div')
  headTexts.append(
    el('h2', 'card-title', ot('opt.writing.s8', 'AI 写作助手')),
    el(
      'p',
      'card-desc',
      ot('opt.writing.s9', '选中文字后在气泡中点击「✍ 写作」，可对所选文本进行润色、续写、总结、回复或翻译；结果支持一键复制或替换选区。'),
    ),
  )
  head.append(
    headTexts,
    buildSwitch(ctx, config.writing.enabled, ot('opt.writing.s8', 'AI 写作助手'), (v) => {
      patchConfig({ writing: { ...config.writing, enabled: v } })
    }),
  )
  const switchCard = el('section', 'card')
  switchCard.append(head)

  // ===== 卡片 2：默认偏好（语气 / 篇幅） =====
  const prefCard = card(
    ctx,
    ot('opt.writing.s10', '默认偏好'),
    ot('opt.writing.s11', '写作面板的初始语气与篇幅；面板中可临时调整，不影响此处默认值。'),
  )
  const toneSel = buildEnumSelect(ctx, TONE_OPTIONS, 'default', (v) => {
    loadPrefs((p) => savePrefs({ ...p, tone: v }))
  })
  const lengthSel = buildEnumSelect(ctx, LENGTH_OPTIONS, 'default', (v) => {
    loadPrefs((p) => savePrefs({ ...p, length: v }))
  })
  loadPrefs((p) => {
    toneSel.value = p.tone
    lengthSel.value = p.length
  })
  prefCard.append(
    fieldRow(ctx, ot('opt.writing.s12', '默认语气'), toneSel),
    fieldRow(ctx, ot('opt.writing.s13', '默认篇幅'), lengthSel),
    el('p', 'hint', ot('opt.writing.s14', '偏好保存在本机，仅作为划词写作面板的初始选项。')),
  )

  // ===== 卡片 3：功能说明 =====
  const infoCard = card(ctx, ot('opt.writing.s15', '功能说明'), ot('opt.writing.s16', 'AI 写作助手的能力与使用方式。'))
  const items: Array<[string, string]> = [
    [ot('opt.writing.s17', '润色'), ot('opt.writing.s18', '改进表达与流畅度，保持原意不变')],
    [ot('opt.writing.s19', '续写'), ot('opt.writing.s20', '沿原文风格自然续写一段')],
    [ot('opt.writing.s21', '总结'), ot('opt.writing.s22', '提炼 3-5 条要点（bullet 列表）')],
    [ot('opt.writing.s23', '回复'), ot('opt.writing.s24', '针对邮件 / 评论生成得体回复，可搭配语气选项')],
    [ot('opt.writing.s25', '翻译'), ot('opt.writing.s26', '把所选文本翻译为目标语言')],
  ]
  for (const [name, desc] of items) {
    const p = el('p', 'hint')
    p.append(el('strong', undefined, `${name}：`), document.createTextNode(desc))
    infoCard.append(p)
  }
  infoCard.append(
    el('p', 'hint', ot('opt.writing.s27', '入口：网页中选中文字 → 划词气泡 →「✍ 写作」。')),
    el('p', 'hint', ot('opt.writing.s28', '引擎：复用「翻译引擎」页的 OpenAI 兼容 / DeepSeek 配置，需先填写 API Key。')),
    el('p', 'hint', ot('opt.writing.s29', '隐私：所选文本仅发送至你配置的 AI 端点，扩展无中间服务器、无遥测。')),
  )

  root.append(switchCard, prefCard, infoCard)
}
