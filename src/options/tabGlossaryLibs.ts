/**
 * Rtranslate options — AI 术语库标签页模块。
 *
 * 由 options/main.ts 接线调用：renderGlossaryLibsTab(root, { config, patchConfig, el })。
 * 管理 config.glossaryLibs（enabled 开关表 + custom 自定义库）：
 * - 内置库列表：名称 + 条目数（异步加载 public/glossary/ 后显示）+ 启用开关；
 * - 自定义库：新建（名称 + 粘贴 CSV 文本导入）、启用开关、删除；
 * - 智能提取术语：textarea 粘贴文本 → {kind:'extractTerms'} → 结果勾选表格 → 加入自定义库。
 *
 * 样式只复用 style.css 已有类名（card/field/control/btn/switch/data-table/tag 等），不新增 CSS。
 */
import type { Config, GlossaryTerm, CustomGlossaryLibrary } from '../shared/config'
import type { BgRequest, BgResponse } from '../shared/protocol'
import { genId } from '../shared/ids'
import {
  listBuiltinLibraries,
  loadBuiltinLibrary,
  parseGlossaryCsv,
  type BuiltinLibraryMeta,
} from '../background/glossaryLibs'
import { t, resolveUiLang } from '../shared/i18n'

/** 模块级界面语言（renderGlossaryLibsTab 进入时设置；sendBg 等无 ctx 的辅助函数用） */
let moduleUiLang: string = 'zh-CN'
const otModule = (key: string, zh: string): string => t(key, moduleUiLang, zh)

export interface GlossaryLibsTabCtx {
  config: Config
  patchConfig: (p: Partial<Config>) => Promise<void>
  el: (tag: string, cls?: string, text?: string) => HTMLElement
}

/** 模块内自发消息（extractTerms），与 main.ts 的 sendBg 同约定。 */
async function sendBg<T>(msg: BgRequest): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T> | undefined
  if (!resp || typeof resp !== 'object' || !('ok' in resp)) throw new Error(otModule('opt.glossaryLibs.s1', 'background 未响应'))
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type GlossaryLibs = Config['glossaryLibs']

function libsOf(config: Config): GlossaryLibs {
  const libs = config.glossaryLibs
  return {
    enabled: libs?.enabled ?? {},
    custom: Array.isArray(libs?.custom) ? libs.custom : [],
  }
}

// ── 智能提取卡片的会话状态（重渲染时保留） ─────────────────────────────────────

interface ExtractState {
  text: string
  busy: boolean
  error: string
  results: GlossaryTerm[]
  checked: Set<number>
  targetLibId: string // '' = 新建库
  notice: string
}

const extractState: ExtractState = {
  text: '',
  busy: false,
  error: '',
  results: [],
  checked: new Set<number>(),
  targetLibId: '',
  notice: '',
}

export function renderGlossaryLibsTab(root: HTMLElement, ctx: GlossaryLibsTabCtx): void {
  moduleUiLang = resolveUiLang(ctx.config.uiLang)
  const { config, patchConfig } = ctx
  const libs = libsOf(config)

  const patchLibs = (next: GlossaryLibs): void => {
    void patchConfig({ glossaryLibs: next })
  }

  root.append(buildBuiltinCard(libs, ctx, patchLibs), buildCustomCard(libs, ctx, patchLibs))
  root.append(buildExtractCard(libs, ctx, patchLibs))
}

// ===== 内置库卡片 =====

function buildBuiltinCard(
  libs: GlossaryLibs,
  ctx: GlossaryLibsTabCtx,
  patchLibs: (n: GlossaryLibs) => void,
): HTMLElement {
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)
  const { el } = ctx
  const card = el('section', 'card')
  card.append(el('h2', 'card-title', ot('opt.glossaryLibs.s2', '内置术语库')))
  card.append(
    el(
      'p',
      'card-desc',
      ot('opt.glossaryLibs.s3', '内置库来自沉浸式翻译术语表（github.com/immersive-translate/terms）。AI 术语库仅在使用 AI 翻译时生效；启用后命中术语将以占位符保护并保证译法一致。'),
    ),
  )

  const listWrap = el('div')
  listWrap.append(el('p', 'empty', ot('opt.glossaryLibs.s4', '加载中…')))
  card.append(listWrap)

  // 异步加载索引 + 各库条目数
  void (async () => {
    let metas: BuiltinLibraryMeta[]
    try {
      metas = await listBuiltinLibraries()
    } catch {
      listWrap.replaceChildren(el('p', 'empty', ot('opt.glossaryLibs.s5', '内置库索引加载失败。')))
      return
    }
    const counts = await Promise.all(
      metas.map(async (m) => {
        try {
          return (await loadBuiltinLibrary(m.id)).length
        } catch {
          return -1
        }
      }),
    )
    // 卡片可能已因切换标签页被卸载
    if (!listWrap.isConnected) return
    listWrap.replaceChildren()
    metas.forEach((meta, i) => {
      const row = el('div', 'field')
      const labelWrap = el('span', 'field-label')
      labelWrap.append(el('span', undefined, moduleUiLang.startsWith('zh') ? meta.zhName : meta.name))
      const countText = counts[i] >= 0 ? ot('opt.glossaryLibs.s6', `${counts[i]} 条`) : ot('opt.glossaryLibs.s7', '加载失败')
      const countTag = el('span', 'tag', countText)
      countTag.style.marginLeft = '8px'
      labelWrap.append(countTag)

      const on = libs.enabled[meta.id] === true
      const sw = el('input') as HTMLInputElement
      sw.type = 'checkbox'
      sw.className = 'switch'
      sw.checked = on
      sw.setAttribute('aria-label', ot('opt.glossaryLibs.s8', `启用内置库：${moduleUiLang.startsWith('zh') ? meta.zhName : meta.name}`))
      sw.addEventListener('change', () => {
        patchLibs({ ...libsOf(ctx.config), enabled: { ...libsOf(ctx.config).enabled, [meta.id]: sw.checked } })
      })
      row.append(labelWrap, sw)
      listWrap.append(row)
    })
  })()

  return card
}

// ===== 自定义库卡片 =====

function buildCustomCard(
  libs: GlossaryLibs,
  ctx: GlossaryLibsTabCtx,
  patchLibs: (n: GlossaryLibs) => void,
): HTMLElement {
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)
  const { el } = ctx
  const card = el('section', 'card')
  card.append(el('h2', 'card-title', ot('opt.glossaryLibs.s9', '自定义术语库')))
  card.append(
    el('p', 'card-desc', ot('opt.glossaryLibs.s10', '粘贴 CSV 文本导入（格式：原文,译文 或 source,target,tgt_lng 表头），可建多个库分别启用。')),
  )

  if (libs.custom.length === 0) {
    card.append(el('p', 'empty', ot('opt.glossaryLibs.s11', '暂无自定义库，在下方新建。')))
  } else {
    for (const lib of libs.custom) {
      const row = el('div', 'field')
      const labelWrap = el('span', 'field-label')
      labelWrap.append(el('span', undefined, lib.name))
      const countTag = el('span', 'tag', ot('opt.glossaryLibs.s12', `${lib.terms.length} 条`))
      countTag.style.marginLeft = '8px'
      labelWrap.append(countTag)

      const right = el('span')
      right.style.display = 'flex'
      right.style.gap = '8px'
      right.style.alignItems = 'center'

      const enabled = libs.enabled[lib.id] !== false // 默认启用
      const sw = el('input') as HTMLInputElement
      sw.type = 'checkbox'
      sw.className = 'switch'
      sw.checked = enabled
      sw.setAttribute('aria-label', ot('opt.glossaryLibs.s13', `启用自定义库：${lib.name}`))
      sw.addEventListener('change', () => {
        patchLibs({ ...libsOf(ctx.config), enabled: { ...libsOf(ctx.config).enabled, [lib.id]: sw.checked } })
      })

      const del = el('button', 'btn-link-danger', ot('opt.glossaryLibs.s14', '删除'))
      del.setAttribute('type', 'button')
      del.addEventListener('click', () => {
        const cur = libsOf(ctx.config)
        const nextEnabled = { ...cur.enabled }
        delete nextEnabled[lib.id]
        patchLibs({
          enabled: nextEnabled,
          custom: cur.custom.filter((l) => l.id !== lib.id),
        })
      })

      right.append(sw, del)
      row.append(labelWrap, right)
      card.append(row)
    }
  }

  // 新建表单：名称 + CSV 文本
  const nameInput = el('input', 'control') as HTMLInputElement
  nameInput.type = 'text'
  nameInput.placeholder = ot('opt.glossaryLibs.s15', '库名称，如：我的医学术语')
  nameInput.spellcheck = false
  const nameRow = el('div', 'field')
  nameRow.append(el('span', 'field-label', ot('opt.glossaryLibs.s16', '名称')), nameInput)

  const csvArea = el('textarea', 'control') as HTMLTextAreaElement
  csvArea.rows = 5
  csvArea.spellcheck = false
  csvArea.placeholder = ot('opt.glossaryLibs.s17', '粘贴 CSV，每行一条：原文,译文（可带 source,target,tgt_lng 表头）')
  const csvRow = el('div', 'field field-top')
  csvRow.append(el('span', 'field-label', ot('opt.glossaryLibs.s18', 'CSV 文本')), csvArea)

  const feedback = el('p', 'hint', '')
  const addBtn = el('button', 'btn', ot('opt.glossaryLibs.s19', '新建库'))
  addBtn.setAttribute('type', 'button')
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim()
    if (!name) {
      feedback.textContent = ot('opt.glossaryLibs.s20', '请填写库名称。')
      return
    }
    const terms = parseImportCsv(csvArea.value)
    if (terms.length === 0) {
      feedback.textContent = ot('opt.glossaryLibs.s21', '未解析到有效术语（每行：原文,译文）。')
      return
    }
    const cur = libsOf(ctx.config)
    const created: CustomGlossaryLibrary = { id: `custom-${genId()}`, name, terms }
    patchLibs({ ...cur, custom: [...cur.custom, created] })
    extractState.notice = ''
  })
  const btnRow = el('div')
  btnRow.style.marginTop = '12px'
  btnRow.append(addBtn)

  card.append(nameRow, csvRow, feedback, btnRow)
  return card
}

/** 自定义库导入解析：优先标准 CSV（含表头）；无 tgt_lng 列时按 原文,译文 两列容错。 */
function parseImportCsv(text: string): GlossaryTerm[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // 标准三列格式（含表头或 tgt_lng 列）直接复用解析器
  const standard = parseGlossaryCsv(trimmed)
  if (standard.length > 0) return standard
  // 两列容错：原文,译文（允许引号；跳过表头行）
  const seen = new Set<string>()
  const terms: GlossaryTerm[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const cols = splitCsvLine(line)
    if (cols.length < 2) continue
    const src = cols[0].trim()
    const dst = cols[1].trim()
    if (!src || !dst) continue
    if (src.toLowerCase() === 'source' && dst.toLowerCase() === 'target') continue
    const key = src.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push({ src, dst })
  }
  return terms
}

/** 单行 CSV 切分（引号包裹可含逗号，"" 转义）。 */
function splitCsvLine(line: string): string[] {
  const cols: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      cols.push(field)
      field = ''
    } else {
      field += c
    }
  }
  cols.push(field)
  return cols
}

// ===== 智能提取卡片 =====

function buildExtractCard(
  libs: GlossaryLibs,
  ctx: GlossaryLibsTabCtx,
  patchLibs: (n: GlossaryLibs) => void,
): HTMLElement {
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)
  const { config, el } = ctx
  const card = el('section', 'card')
  card.append(el('h2', 'card-title', ot('opt.glossaryLibs.s22', '智能提取术语')))
  card.append(
    el('p', 'card-desc', ot('opt.glossaryLibs.s23', '粘贴一段文本，用 AI 提取其中的专业术语 / 专名并给出推荐译法；勾选后加入自定义库。需要已配置 AI 引擎（OpenAI 兼容 / DeepSeek）。')),
  )

  const area = el('textarea', 'control') as HTMLTextAreaElement
  area.rows = 5
  area.spellcheck = false
  area.placeholder = ot('opt.glossaryLibs.s24', '粘贴要提取术语的原文（截取前 4000 字符发送）')
  area.value = extractState.text
  area.addEventListener('input', () => {
    extractState.text = area.value
  })
  const areaRow = el('div', 'field field-top')
  areaRow.append(el('span', 'field-label', ot('opt.glossaryLibs.s25', '文本')), area)

  const status = el('p', 'hint', extractState.error || extractState.notice || '')
  if (extractState.error) status.style.color = 'var(--tv-danger-text, #c4564a)'

  const extractBtn = el('button', 'btn', extractState.busy ? ot('opt.glossaryLibs.s26', '提取中…') : ot('opt.glossaryLibs.s27', 'AI 提取'))
  extractBtn.setAttribute('type', 'button')
  if (extractState.busy) extractBtn.setAttribute('disabled', 'true')
  extractBtn.addEventListener('click', () => {
    const text = area.value.trim()
    if (!text || extractState.busy) return
    extractState.busy = true
    extractState.error = ''
    extractState.notice = ''
    rerender(card, ctx)
    void sendBg<GlossaryTerm[]>({
      kind: 'extractTerms',
      text,
      targetLang: config.general.targetLang,
    })
      .then((terms) => {
        extractState.results = terms
        extractState.checked = new Set(terms.map((_, i) => i))
        extractState.notice = terms.length > 0 ? '' : ot('opt.glossaryLibs.s28', 'AI 未提取到术语。')
      })
      .catch((e: unknown) => {
        extractState.results = []
        extractState.checked = new Set()
        extractState.error = ot('opt.glossaryLibs.s29', `提取失败：${errMsg(e)}`)
      })
      .finally(() => {
        extractState.busy = false
        if (card.isConnected) rerender(card, ctx)
      })
  })
  const btnRow = el('div')
  btnRow.style.marginTop = '12px'
  btnRow.append(extractBtn)

  card.append(areaRow, btnRow, status)

  // 结果表格（可勾选）+ 加入自定义库
  if (extractState.results.length > 0) {
    const table = el('table', 'data-table')
    table.style.marginTop = '12px'
    const thead = el('thead')
    const htr = el('tr')
    htr.append(el('th', undefined, ''), el('th', undefined, ot('opt.glossaryLibs.s30', '原文')), el('th', undefined, ot('opt.glossaryLibs.s31', '译文')))
    thead.append(htr)
    const tbody = el('tbody')
    extractState.results.forEach((t, i) => {
      const tr = el('tr')
      const checkTd = el('td')
      const cb = el('input') as HTMLInputElement
      cb.type = 'checkbox'
      cb.checked = extractState.checked.has(i)
      cb.setAttribute('aria-label', ot('opt.glossaryLibs.s32', `选择 ${t.src}`))
      cb.addEventListener('change', () => {
        if (cb.checked) extractState.checked.add(i)
        else extractState.checked.delete(i)
      })
      checkTd.append(cb)
      tr.append(checkTd, el('td', undefined, t.src), el('td', undefined, t.dst))
      tbody.append(tr)
    })
    table.append(thead, tbody)
    card.append(table)

    // 目标库选择 + 加入按钮
    const targetSel = el('select', 'control') as HTMLSelectElement
    const newOpt = el('option', undefined, ot('opt.glossaryLibs.s33', '＋ 新建库')) as HTMLOptionElement
    newOpt.value = ''
    targetSel.append(newOpt)
    for (const lib of libs.custom) {
      const opt = el('option', undefined, lib.name) as HTMLOptionElement
      opt.value = lib.id
      targetSel.append(opt)
    }
    targetSel.value = extractState.targetLibId
    if (targetSel.value !== extractState.targetLibId) {
      extractState.targetLibId = ''
      targetSel.value = ''
    }
    targetSel.addEventListener('change', () => {
      extractState.targetLibId = targetSel.value
    })

    const importBtn = el('button', 'btn btn-secondary', ot('opt.glossaryLibs.s34', '加入自定义库'))
    importBtn.setAttribute('type', 'button')
    importBtn.addEventListener('click', () => {
      const picked = extractState.results.filter((_, i) => extractState.checked.has(i))
      if (picked.length === 0) {
        extractState.error = ot('opt.glossaryLibs.s35', '请先勾选要加入的术语。')
        rerender(card, ctx)
        return
      }
      const cur = libsOf(ctx.config)
      const targetId = extractState.targetLibId
      if (targetId && cur.custom.some((l) => l.id === targetId)) {
        // 追加到已有库（同名 src 不重复）
        const nextCustom = cur.custom.map((l) => {
          if (l.id !== targetId) return l
          const existing = new Set(l.terms.map((t) => t.src.toLowerCase()))
          const added = picked.filter((t) => !existing.has(t.src.toLowerCase()))
          return { ...l, terms: [...l.terms, ...added] }
        })
        extractState.notice = ot('opt.glossaryLibs.s36', `已加入 ${picked.length} 条到所选库。`)
        patchLibs({ ...cur, custom: nextCustom })
      } else {
        const created: CustomGlossaryLibrary = {
          id: `custom-${genId()}`,
          name: ot('opt.glossaryLibs.s37', `AI 提取 ${new Date().toLocaleDateString('zh-CN')}`),
          terms: picked,
        }
        extractState.notice = ot('opt.glossaryLibs.s38', `已新建库「${created.name}」（${picked.length} 条）。`)
        patchLibs({ ...cur, custom: [...cur.custom, created] })
      }
      extractState.error = ''
      extractState.results = []
      extractState.checked = new Set()
    })

    const importRow = el('div', 'adder')
    importRow.style.marginTop = '12px'
    importRow.append(targetSel, importBtn)
    card.append(importRow)
  }

  return card
}

/** 局部重渲染：找到卡片所属的内容容器整体重画本标签页。 */
function rerender(card: HTMLElement, ctx: GlossaryLibsTabCtx): void {
  const root = card.parentElement
  if (!root) return
  root.replaceChildren()
  renderGlossaryLibsTab(root, ctx)
}
