/**
 * Rtranslate options — AI 专家管理标签页模块。
 *
 * 由 options/main.ts 接线调用：renderExpertsTab(root, { config, patchConfig, el })。
 * 仅管理 config.experts（activeId + list），所有修改即时通过 patchConfig 保存；
 * patchConfig 成功后 main.ts 会整体重渲染本标签页。
 *
 * 样式只复用 style.css 已有类名（card/field/control/btn/radio-item/tag 等），不新增 CSS。
 */
import type { Config, ExpertPreset } from '../shared/config'
import { BUILTIN_EXPERTS } from '../core/experts'
import { genId } from '../shared/ids'
import { t, resolveUiLang } from '../shared/i18n'
import { expertName } from '../shared/uiLabels'

/** 模块级界面语言（renderExpertsTab 进入时设置；嵌套辅助函数共用） */
let moduleUiLang: string = 'zh-CN'
const ot = (key: string, zh: string): string => t(key, moduleUiLang, zh)

export interface ExpertsTabCtx {
  config: Config
  patchConfig: (p: Partial<Config>) => Promise<void>
  el: (tag: string, cls?: string, text?: string) => HTMLElement
}

/** 表单状态：closed=仅列表；create=新建；edit=编辑自定义；view=查看内置（只读）。 */
type FormState =
  | { mode: 'closed' }
  | { mode: 'create'; draft?: ExpertPreset }
  | { mode: 'edit'; id: string }
  | { mode: 'view'; id: string }

let formState: FormState = { mode: 'closed' }

const PLACEHOLDER_HINT =
  ot('opt.experts.s1', '可用占位符：{{text}} 原文、{{to}} 目标语言、{{from}} 源语言、{{glossary}} 术语表（无术语时该行自动删除）。')

function firstLine(s: string, max = 60): string {
  const line = s.split('\n')[0].trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

export function renderExpertsTab(root: HTMLElement, ctx: ExpertsTabCtx): void {
  moduleUiLang = resolveUiLang(ctx.config.uiLang)
  const { config, patchConfig, el } = ctx
  // 归一兜底：存储里 experts 缺失/脏数据时用内置列表渲染，不写回（写回交给 normalizeConfig）
  const experts = config.experts ?? { activeId: 'general', list: BUILTIN_EXPERTS }
  const list = Array.isArray(experts.list) ? experts.list : BUILTIN_EXPERTS
  const activeId = experts.activeId || 'general'

  const patchExperts = (next: { activeId: string; list: ExpertPreset[] }): void => {
    void patchConfig({ experts: next })
  }

  // ===== 专家列表卡 =====
  const listCard = el('section', 'card')
  listCard.append(el('h2', 'card-title', ot('opt.experts.s2', 'AI 专家')))
  listCard.append(
    el(
      'p',
      'card-desc',
      ot('opt.experts.s3', 'AI 专家仅在使用 AI 引擎（OpenAI 兼容/DeepSeek）时生效。每个专家定义一套 system/user prompt 翻译策略，单选其一作为当前生效策略。'),
    ),
  )

  const group = el('div', 'radio-group')
  for (const expert of list) {
    const item = el('div', 'radio-item')
    item.style.width = '100%'

    const radio = el('input') as HTMLInputElement
    radio.type = 'radio'
    radio.name = 'tv-expert-active'
    radio.checked = expert.id === activeId
    radio.setAttribute('aria-label', ot('opt.experts.s4', `设为当前：${expertName(expert, moduleUiLang)}`))
    radio.addEventListener('change', () => {
      if (radio.checked && expert.id !== activeId) {
        patchExperts({ activeId: expert.id, list })
      }
    })

    const textWrap = el('span', 'radio-text')
    textWrap.style.flex = '1'
    const labelRow = el('span', 'radio-label')
    labelRow.append(el('span', undefined, expertName(expert, moduleUiLang)))
    const typeTag = el('span', 'tag', expert.builtin ? ot('opt.experts.s5', '内置') : ot('opt.experts.s6', '自定义'))
    typeTag.style.marginLeft = '8px'
    typeTag.style.padding = '2px 10px'
    labelRow.append(typeTag)
    textWrap.append(labelRow, el('span', 'radio-desc', firstLine(expert.systemPrompt)))

    const actions = el('span')
    actions.style.display = 'flex'
    actions.style.gap = '6px'
    actions.style.flex = '0 0 auto'

    if (expert.builtin) {
      // 文字链样式降噪（视觉审查 #22）：不再用等宽蓝描边按钮
      const viewBtn = el('button', 'text-link', ot('opt.experts.s7', '查看'))
      viewBtn.setAttribute('type', 'button')
      viewBtn.addEventListener('click', () => {
        formState = { mode: 'view', id: expert.id }
        rerender(root, ctx)
      })
      actions.append(viewBtn)
    } else {
      const editBtn = el('button', 'btn btn-ghost', ot('opt.experts.s8', '编辑'))
      editBtn.setAttribute('type', 'button')
      editBtn.addEventListener('click', () => {
        formState = { mode: 'edit', id: expert.id }
        rerender(root, ctx)
      })
      const delBtn = el('button', 'btn btn-ghost', ot('opt.experts.s9', '删除'))
      delBtn.setAttribute('type', 'button')
      delBtn.style.color = 'var(--tv-danger-text, #c4564a)'
      delBtn.addEventListener('click', () => {
        const nextList = list.filter((e) => e.id !== expert.id)
        // 删除当前激活专家时回退到「通用」
        const nextActive = expert.id === activeId ? 'general' : activeId
        if (formState.mode !== 'closed') formState = { mode: 'closed' }
        patchExperts({ activeId: nextActive, list: nextList })
      })
      actions.append(editBtn, delBtn)
    }

    item.append(radio, textWrap, actions)
    group.append(item)
  }
  listCard.append(group)

  const newBtn = el('button', 'btn btn-secondary', ot('opt.experts.s10', '新建专家'))
  newBtn.setAttribute('type', 'button')
  newBtn.style.marginTop = '12px'
  newBtn.addEventListener('click', () => {
    formState = { mode: 'create' }
    rerender(root, ctx)
  })
  listCard.append(newBtn)
  root.append(listCard)

  // ===== 表单卡（新建 / 编辑 / 查看） =====
  if (formState.mode !== 'closed') {
    const formCard = buildForm(formState, list, ctx, patchExperts)
    if (formCard) root.append(formCard)
  }
}

/** 局部重渲染：清空 root 后按最新状态重画（patchConfig 保存成功后由 main.ts 整体重渲染）。 */
function rerender(root: HTMLElement, ctx: ExpertsTabCtx): void {
  root.replaceChildren()
  renderExpertsTab(root, ctx)
}

function buildForm(
  state: Exclude<FormState, { mode: 'closed' }>,
  list: ExpertPreset[],
  ctx: ExpertsTabCtx,
  patchExperts: (next: { activeId: string; list: ExpertPreset[] }) => void,
): HTMLElement | null {
  const { config, el } = ctx
  const readonly = state.mode === 'view'

  let draft: ExpertPreset | undefined
  let title = ot('opt.experts.s10', '新建专家')
  if (state.mode === 'create') {
    draft = state.draft ?? {
      id: '',
      name: '',
      builtin: false,
      systemPrompt: BUILTIN_EXPERTS[0].systemPrompt,
      userPrompt: BUILTIN_EXPERTS[0].userPrompt,
    }
    if (state.draft) title = ot('opt.experts.s11', '新建专家（已复制内置模板）')
  } else {
    const found = list.find((e) => e.id === state.id)
    if (!found) return null // 专家已被删除
    draft = found
    title = state.mode === 'edit' ? ot('opt.experts.s12', `编辑专家：${expertName(found, moduleUiLang)}`) : ot('opt.experts.s13', `查看内置专家：${expertName(found, moduleUiLang)}`)
  }

  const card = el('section', 'card')
  card.append(el('h2', 'card-title', title))
  if (readonly) {
    card.append(el('p', 'card-desc', ot('opt.experts.s14', '内置专家为只读；如需修改，请点击「复制为自定义」生成可编辑副本。')))
  } else {
    card.append(el('p', 'card-desc', ot('opt.experts.s15', '保存后立即生效；user prompt 中的占位符在每次翻译时按实际值替换。')))
  }

  // 名称
  const nameInput = el('input', 'control') as HTMLInputElement
  nameInput.type = 'text'
  nameInput.value = draft.name
  nameInput.placeholder = ot('opt.experts.s16', '专家名称，如：技术文档')
  nameInput.spellcheck = false
  nameInput.disabled = readonly
  const nameRow = el('div', 'field')
  nameRow.append(el('span', 'field-label', ot('opt.experts.s17', '名称')), nameInput)

  // systemPrompt
  const sysArea = el('textarea', 'control') as HTMLTextAreaElement
  sysArea.rows = 4
  sysArea.value = draft.systemPrompt
  sysArea.spellcheck = false
  sysArea.disabled = readonly
  sysArea.placeholder = ot('opt.experts.s18', 'System prompt：定义翻译角色与风格要求')
  const sysRow = el('div', 'field field-top')
  sysRow.append(el('span', 'field-label', 'System Prompt'), sysArea)

  // userPrompt
  const userArea = el('textarea', 'control') as HTMLTextAreaElement
  userArea.rows = 5
  userArea.value = draft.userPrompt
  userArea.spellcheck = false
  userArea.disabled = readonly
  userArea.placeholder = ot('opt.experts.s19', 'User prompt 模板，如：Translate the following text into {{to}}:\n\n{{text}}')
  const userRow = el('div', 'field field-top')
  userRow.append(el('span', 'field-label', ot('opt.experts.s20', 'User Prompt 模板')), userArea)

  const hint = el('p', 'hint', PLACEHOLDER_HINT)

  // 按钮行
  const btnRow = el('div')
  btnRow.style.display = 'flex'
  btnRow.style.gap = '8px'
  btnRow.style.marginTop = '12px'

  const cancelBtn = el('button', 'btn btn-ghost', readonly ? ot('opt.experts.s21', '关闭') : ot('opt.experts.s22', '取消'))
  cancelBtn.setAttribute('type', 'button')
  cancelBtn.addEventListener('click', () => {
    formState = { mode: 'closed' }
    rerenderFromCard(card, ctx)
  })

  if (readonly) {
    const copyBtn = el('button', 'btn', ot('opt.experts.s23', '复制为自定义'))
    copyBtn.setAttribute('type', 'button')
    copyBtn.addEventListener('click', () => {
      formState = {
        mode: 'create',
        draft: {
          id: '',
          name: ot('opt.experts.s24', `${draft.name} 副本`),
          builtin: false,
          systemPrompt: draft.systemPrompt,
          userPrompt: draft.userPrompt,
        },
      }
      rerenderFromCard(card, ctx)
    })
    btnRow.append(copyBtn, cancelBtn)
  } else {
    const saveBtn = el('button', 'btn', ot('opt.experts.s25', '保存'))
    saveBtn.setAttribute('type', 'button')
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim()
      const systemPrompt = sysArea.value.trim()
      const userPrompt = userArea.value.trim()
      if (!name || !systemPrompt || !userPrompt) {
        saveBtn.textContent = ot('opt.experts.s26', '请填写完整')
        window.setTimeout(() => {
          saveBtn.textContent = ot('opt.experts.s25', '保存')
        }, 1200)
        return
      }
      const experts = config.experts ?? { activeId: 'general', list: BUILTIN_EXPERTS }
      const curList = Array.isArray(experts.list) ? experts.list : BUILTIN_EXPERTS
      if (state.mode === 'create') {
        const created: ExpertPreset = { id: `custom-${genId()}`, name, builtin: false, systemPrompt, userPrompt }
        formState = { mode: 'closed' }
        // 新建后直接设为当前，符合用户预期
        patchExperts({ activeId: created.id, list: [...curList, created] })
      } else {
        const nextList = curList.map((e) => (e.id === state.id ? { ...e, name, systemPrompt, userPrompt } : e))
        formState = { mode: 'closed' }
        patchExperts({ activeId: experts.activeId || 'general', list: nextList })
      }
    })
    btnRow.append(saveBtn, cancelBtn)
  }

  card.append(nameRow, sysRow, userRow, hint, btnRow)
  return card
}

/** 表单内的局部重渲染：找到最近的 .content 容器（root）重画整个标签页。 */
function rerenderFromCard(card: HTMLElement, ctx: ExpertsTabCtx): void {
  const root = card.parentElement
  if (root) rerender(root, ctx)
}
