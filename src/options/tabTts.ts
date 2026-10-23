/**
 * options/tabTts.ts — 设置页「朗读 TTS」标签页模块。
 *
 * 由 options/main.ts 接线调用：renderTtsTab(contentEl, { config, patchConfig, el })。
 * 内容：语速（0.5-2.0）/ 音调（0.5-1.5）/ 音量（0-1）滑块 + 试听 + 功能说明；
 * 全部复用 style.css 现有类名（card / field / field-label / control / field-static / hint / btn）。
 *
 * 参数存 config.tts（shared/config.ts），content/selection.ts 的划词气泡「朗读」读取同一份配置。
 * 试听用模块级 TtsPlayer 单例：patchConfig 触发整页重渲染后播放不中断。
 */
import type { Config } from '../shared/config'
import { TtsPlayer } from '../content/tts'

export interface TtsTabCtx {
  config: Config
  patchConfig: (patch: Partial<Config>) => void
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
  ) => HTMLElementTagNameMap[K]
}

/** 试听播放器单例（选项页内共享，重渲染不中断）。 */
const previewPlayer = new TtsPlayer()

/** 卡片容器：标题 + 说明文案（与 main.ts 的 card() 同款）。 */
function card(ctx: TtsTabCtx, title: string, desc?: string): HTMLElement {
  const c = ctx.el('section', 'card')
  c.append(ctx.el('h2', 'card-title', title))
  if (desc) c.append(ctx.el('p', 'card-desc', desc))
  return c
}

/** 标准表单行：左标签 + 右控件。 */
function fieldRow(ctx: TtsTabCtx, label: string, control: HTMLElement): HTMLElement {
  const row = ctx.el('div', 'field')
  row.append(ctx.el('span', 'field-label', label), control)
  return row
}

interface SliderSpec {
  label: string
  ariaLabel: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onCommit: (v: number) => void
}

/**
 * 滑块行：input[type=range].control + 实时数值（field-static）。
 * input 事件只刷新数值显示；change（释放）才 patchConfig，避免拖动过程频繁写存储/重渲染。
 */
function buildSliderRow(ctx: TtsTabCtx, spec: SliderSpec): { row: HTMLElement; input: HTMLInputElement } {
  const wrap = ctx.el('div')
  wrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;max-width:420px;'
  const input = ctx.el('input', 'control')
  input.type = 'range'
  input.min = String(spec.min)
  input.max = String(spec.max)
  input.step = String(spec.step)
  input.value = String(spec.value)
  input.setAttribute('aria-label', spec.ariaLabel)
  input.style.cssText = 'flex:1;min-width:0;padding:0;'
  const val = ctx.el('span', 'field-static', spec.format(spec.value))
  val.style.cssText = 'min-width:40px;text-align:right;font-variant-numeric:tabular-nums;'
  input.addEventListener('input', () => {
    val.textContent = spec.format(Number(input.value))
  })
  input.addEventListener('change', () => spec.onCommit(Number(input.value)))
  wrap.append(input, val)
  return { row: fieldRow(ctx, spec.label, wrap), input }
}

/** 试听例句：跟随目标语言，覆盖多句以演示按句连播。 */
function sampleText(targetLang: string): string {
  if (targetLang.startsWith('zh')) return '你好，这是 Rtranslate 的朗读试听。语速、音调与音量会即时生效。感谢使用！'
  if (targetLang.startsWith('ja')) return 'こんにちは。Rtranslate の読み上げテストです。速度と音調はすぐに反映されます。'
  if (targetLang.startsWith('ko')) return '안녕하세요. Rtranslate 읽어주기 테스트입니다. 속도와 음높이가 바로 적용됩니다.'
  return 'Hello! This is a Rtranslate speech test. Rate, pitch and volume apply instantly. Thanks for listening!'
}

export function renderTtsTab(root: HTMLElement, ctx: TtsTabCtx): void {
  const { config, patchConfig, el } = ctx

  // ===== 卡片 1：朗读参数 =====
  const paramCard = card(
    ctx,
    '朗读参数',
    '作用于划词气泡的「朗读」按钮；长文本自动按句切分、顺序连播，播放中可随时停止。',
  )

  const rate = buildSliderRow(ctx, {
    label: '语速',
    ariaLabel: '语速',
    min: 0.5,
    max: 2.0,
    step: 0.1,
    value: config.tts.rate,
    format: (v) => `${v.toFixed(1)}x`,
    onCommit: (v) => patchConfig({ tts: { ...config.tts, rate: v } }),
  })
  const pitch = buildSliderRow(ctx, {
    label: '音调',
    ariaLabel: '音调',
    min: 0.5,
    max: 1.5,
    step: 0.1,
    value: config.tts.pitch,
    format: (v) => v.toFixed(1),
    onCommit: (v) => patchConfig({ tts: { ...config.tts, pitch: v } }),
  })
  const volume = buildSliderRow(ctx, {
    label: '音量',
    ariaLabel: '音量',
    min: 0,
    max: 1,
    step: 0.05,
    value: config.tts.volume,
    format: (v) => `${Math.round(v * 100)}%`,
    onCommit: (v) => patchConfig({ tts: { ...config.tts, volume: v } }),
  })
  paramCard.append(rate.row, pitch.row, volume.row)

  // 试听：用滑块当前值（含未提交的拖动中数值）朗读示例句；播放中按钮变「停止」
  const previewBtn = el('button', 'btn btn-secondary', previewPlayer.isPlaying() ? '停止' : '试听')
  previewBtn.type = 'button'
  previewBtn.addEventListener('click', () => {
    if (previewPlayer.isPlaying()) {
      previewPlayer.stop()
      return
    }
    previewPlayer.speak(sampleText(config.general.targetLang), {
      rate: Number(rate.input.value),
      pitch: Number(pitch.input.value),
      volume: Number(volume.input.value),
    })
  })
  previewPlayer.onStateChange = (playing) => {
    previewBtn.textContent = playing ? '停止' : '试听'
  }
  const previewRow = el('div', 'field')
  previewRow.append(el('span', 'field-label', '试听'), previewBtn)
  paramCard.append(previewRow, el('p', 'hint', '示例句包含多个句子，可验证按句连播效果；语种按文本自动判定。'))

  // ===== 卡片 2：功能说明 =====
  const infoCard = card(ctx, '功能说明', '朗读能力的使用方式与边界。')
  const items: Array<[string, string]> = [
    ['入口', '网页中选中文字 → 划词气泡 →「朗读」；播放中按钮变为「停止」，再点即停'],
    ['连播', '长文本按句末标点（。！？.!?；;）切分，逐句播放，规避浏览器对超长文本的截断'],
    ['语种', '按文本中中文/日文假名/韩文谚文占比自动选择 zh-CN / ja-JP / ko-KR，其余默认 en-US'],
    ['音色', '由浏览器与操作系统的语音包决定，可在系统设置中安装更多语音'],
    ['隐私', '朗读完全在本机进行（Web Speech API），文本不发送到任何服务器'],
  ]
  for (const [name, desc] of items) {
    const p = el('p', 'hint')
    p.append(el('strong', undefined, `${name}：`), document.createTextNode(desc))
    infoCard.append(p)
  }

  root.append(paramCard, infoCard)
}
