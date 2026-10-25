/**
 * Rtranslate options — 快捷键自定义标签页模块。
 *
 * 由 options/main.ts 接线调用：renderHotkeysTab(root, { config, patchConfig, el })。
 * 仅管理 config.hotkeys（togglePage / compare / openOptions），所有修改即时通过
 * patchConfig 保存；patchConfig 成功后 main.ts 会整体重渲染本标签页。
 *
 * 录入交互：点击输入框进入捕获态（显示「请按快捷键…」），按下的组合键实时显示，
 * 松开主键时保存为 'Alt+T' 格式；Esc 取消；Backspace/Delete 清空（空串 = 禁用）。
 *
 * 样式只复用 style.css 已有类名（card/field/control/btn 等），不新增 CSS。
 */
import { DEFAULT_CONFIG, type Config } from '../shared/config'
import { t, resolveUiLang } from '../shared/i18n'

export interface HotkeysTabCtx {
  config: Config
  patchConfig: (p: Partial<Config>) => Promise<void>
  el: (tag: string, cls?: string, text?: string) => HTMLElement
}

type HotkeyId = keyof Config['hotkeys']


/** e.code → 规格主键名：KeyT→'T'、Digit1→'1'、Space/Enter/F5 等原样。 */
function codeToKeyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/** 判断按下的键本身是否为修饰键（此时只预览组合，等待主键）。 */
function isModifierCode(code: string): boolean {
  return /^(Alt|Control|Shift|Meta)(Left|Right)$/.test(code)
}

export function renderHotkeysTab(root: HTMLElement, ctx: HotkeysTabCtx): void {
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)

  const ACTIONS: { id: HotkeyId; label: string; hint: string }[] = [
    { id: 'togglePage', label: ot('opt.hotkeys.s1', '切换整页翻译'), hint: ot('opt.hotkeys.s2', '默认 Alt+T') },
    { id: 'compare', label: ot('opt.hotkeys.s3', '对比窗（多引擎对照）'), hint: ot('opt.hotkeys.s4', '默认 Alt+D') },
    { id: 'openOptions', label: ot('opt.hotkeys.s5', '打开设置页'), hint: ot('opt.hotkeys.s6', '默认 Alt+O') },
  ]

  const { config, patchConfig, el } = ctx
  const hotkeys = config.hotkeys ?? DEFAULT_CONFIG.hotkeys

  const card = el('section', 'card')
  card.append(el('h2', 'card-title', ot('opt.hotkeys.s7', '快捷键')))
  card.append(
    el(
      'p',
      'card-desc',
      ot('opt.hotkeys.s8', '点击输入框后按下新的组合键即可修改；Esc 取消，Backspace/Delete 清空（清空 = 禁用该快捷键）。') +
        ot('opt.hotkeys.s9', 'Mac 上 Ctrl 与 Cmd 等价，无需分别配置。'),
    ),
  )
  card.append(
    el('p', 'card-desc', ot('opt.hotkeys.s10', '默认快捷键：Alt+T 切换整页翻译、Alt+D 对比窗、Alt+O 打开设置。')),
  )

  for (const action of ACTIONS) {
    const value = hotkeys[action.id] ?? ''
    const save = (spec: string): void => {
      void patchConfig({ hotkeys: { ...hotkeys, [action.id]: spec } })
    }
    card.append(buildRow(action, value, save, ctx))
  }

  const resetBtn = el('button', 'btn btn-secondary', ot('opt.hotkeys.s11', '恢复默认'))
  resetBtn.setAttribute('type', 'button')
  resetBtn.style.marginTop = '12px'
  resetBtn.addEventListener('click', () => {
    void patchConfig({ hotkeys: { ...DEFAULT_CONFIG.hotkeys } })
  })
  card.append(resetBtn)

  root.append(card)
}

/** 单个快捷键录入行：label + 捕获输入框 + 默认值提示。 */
function buildRow(
  action: { id: HotkeyId; label: string; hint: string },
  value: string,
  save: (spec: string) => void,
  ctx: HotkeysTabCtx,
): HTMLElement {
  const { el } = ctx
  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)

  const input = el('input', 'control') as HTMLInputElement
  input.type = 'text'
  input.readOnly = true
  input.spellcheck = false
  input.value = value || ot('opt.hotkeys.s12', '未设置（已禁用）')
  input.style.width = '240px'
  input.style.cursor = 'pointer'
  input.setAttribute('aria-label', ot('opt.hotkeys.s13', `${action.label}快捷键`))

  let capturing = false
  const stopCapture = (): void => {
    capturing = false
    input.value = value || ot('opt.hotkeys.s12', '未设置（已禁用）')
    input.style.borderColor = ''
    input.blur()
  }

  input.addEventListener('click', () => {
    if (capturing) return
    capturing = true
    input.value = ot('opt.hotkeys.s14', '请按快捷键…')
    input.style.borderColor = 'var(--tv-primary)'
    input.focus()
  })
  input.addEventListener('blur', () => {
    if (capturing) stopCapture()
  })
  input.addEventListener('keydown', (e) => {
    if (!capturing) return
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      stopCapture()
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      save('') // 清空 = 禁用；patchConfig 成功后整体重渲染
      return
    }

    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.metaKey) parts.push('Meta')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    if (isModifierCode(e.code)) {
      // 仅按下修饰键：实时预览组合，等待主键
      input.value = parts.length ? `${parts.join('+')}+…` : ot('opt.hotkeys.s14', '请按快捷键…')
      return
    }
    parts.push(codeToKeyName(e.code))
    save(parts.join('+'))
  })

  const textWrap = el('span')
  textWrap.style.display = 'inline-flex'
  textWrap.style.alignItems = 'baseline'
  textWrap.style.gap = '8px'
  const hintEl = el('span', 'hint', action.hint)
  hintEl.style.margin = '0'
  textWrap.append(input, hintEl)

  const row = el('div', 'field')
  row.append(el('span', 'field-label', action.label), textWrap)
  return row
}
