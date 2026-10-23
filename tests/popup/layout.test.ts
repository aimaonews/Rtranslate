// @vitest-environment jsdom
/**
 * popup 布局与 i18n 测试：
 * - 控制区行序（语言对第一行，其后 引擎/专家/显示模式/译文样式/悬停/划词/悬浮球，当前网站区垫底）
 * - 语言对行结构（源语言 → 目标语言 双下拉并排）与源语言下拉写 config.general.sourceLang + 热同步
 * - uiLang=en 时行标签/按钮/状态文案变英文；zh-CN 与中文现状一致
 *
 * chrome API 用内存 stub 模拟：setConfig 为顶层浅合并（与 store 语义一致，
 * patch 内嵌套对象由调用方整对象展开），pageState 默认返回 null（页面不可用）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { init } from '../../src/popup/main'

type Msg = { kind: string; patch?: Partial<Config>; [k: string]: unknown }

let cfg: Config
let runtimeMessages: Msg[]
let tabMessages: Array<{ tabId: number; msg: Msg }>

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function installChromeStub(): void {
  runtimeMessages = []
  tabMessages = []
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      getURL: (p: string): string => p,
      sendMessage: (msg: Msg): Promise<unknown> => {
        runtimeMessages.push(msg)
        switch (msg.kind) {
          case 'getConfig':
            return Promise.resolve({ ok: true, data: clone(cfg) })
          case 'setConfig':
            cfg = { ...cfg, ...msg.patch }
            return Promise.resolve({ ok: true, data: clone(cfg) })
          case 'getStats':
            return Promise.resolve({ ok: true, data: { totalWords: 3, dueCount: 2 } })
          default:
            return Promise.resolve({ ok: true, data: null })
        }
      },
    },
    tabs: {
      query: (): Promise<unknown[]> => Promise.resolve([{ id: 7 }]),
      sendMessage: (tabId: number, msg: Msg): Promise<unknown> => {
        tabMessages.push({ tabId, msg })
        return Promise.resolve(null)
      },
    },
  }
}

/** 挂载 popup：重置 #app，跑 init 并等待异步刷新（pageState/stats）落地 */
async function mount(config: Config): Promise<HTMLElement> {
  cfg = clone(config)
  installChromeStub()
  document.body.innerHTML = '<div id="app"></div>'
  await init()
  await flush()
  await flush()
  return document.getElementById('app') as HTMLElement
}

function rowLabel(app: HTMLElement, key: string): string | null | undefined {
  return app.querySelector(`.row[data-row="${key}"] .row-label`)?.textContent
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('popup 控制区行序', () => {
  it('语言对第一行，其后依次为 引擎/专家/显示模式/译文样式/悬停/划词/悬浮球', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const rows = Array.from(app.querySelectorAll('.controls > .row')).map(
      (r) => (r as HTMLElement).dataset.row,
    )
    expect(rows).toEqual([
      'lang',
      'engine',
      'expert',
      'displayMode',
      'style',
      'hover',
      'selection',
      'floatingBall',
    ])
  })

  it('当前网站区保持在最后', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const controls = app.querySelector('.controls') as HTMLElement
    const last = controls.lastElementChild as HTMLElement
    expect(last.classList.contains('site-rules')).toBe(true)
    expect(last.querySelector('.site-rules-label')?.textContent).toBe('当前网站')
  })

  it('语言对行：源语言 + → + 目标语言 双下拉并排', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const row = app.querySelector('.row[data-row="lang"]') as HTMLElement
    const selects = row.querySelectorAll('select')
    expect(selects).toHaveLength(2)
    expect(selects[0].dataset.langKind).toBe('source')
    expect(selects[1].dataset.langKind).toBe('target')
    const arrow = row.querySelector('.lang-pair-arrow')
    expect(arrow?.textContent).toBe('→')
    // 箭头在两个下拉之间
    const children = Array.from(row.querySelector('.lang-pair')!.children)
    expect(children[0]).toBe(selects[0])
    expect(children[1]).toBe(arrow)
    expect(children[2]).toBe(selects[1])
  })
})

describe('源语言下拉', () => {
  it('自动检测(auto) 在常用组首位且只出现一次，初始选中 config.general.sourceLang', async () => {
    const app = await mount({
      ...clone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, sourceLang: 'ja' },
    })
    const src = app.querySelector('select[data-lang-kind="source"]') as HTMLSelectElement
    expect(src.value).toBe('ja')
    const groups = src.querySelectorAll('optgroup')
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelector('option')?.value).toBe('auto')
    expect(Array.from(src.options).filter((o) => o.value === 'auto')).toHaveLength(1)
  })

  it('默认配置选中 auto', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const src = app.querySelector('select[data-lang-kind="source"]') as HTMLSelectElement
    expect(src.value).toBe('auto')
  })

  it('切换源语言写入 config.general.sourceLang 并向当前 tab 热同步 configChanged', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const src = app.querySelector('select[data-lang-kind="source"]') as HTMLSelectElement
    runtimeMessages.length = 0
    tabMessages.length = 0
    src.value = 'en'
    src.dispatchEvent(new Event('change'))
    await flush()
    const setMsg = runtimeMessages.find((m) => m.kind === 'setConfig')
    expect(setMsg?.patch).toMatchObject({ general: { sourceLang: 'en' } })
    expect(cfg.general.sourceLang).toBe('en')
    const sync = tabMessages.find((m) => m.msg.kind === 'configChanged')
    expect(sync).toBeTruthy()
    expect((sync?.msg as unknown as { config: Config }).config.general.sourceLang).toBe('en')
  })

  it('目标语言下拉保持原逻辑：切换写 targetLang 并热同步', async () => {
    const app = await mount(DEFAULT_CONFIG)
    const tgt = app.querySelector('select[data-lang-kind="target"]') as HTMLSelectElement
    expect(tgt.value).toBe('zh-CN')
    tabMessages.length = 0
    tgt.value = 'ja'
    tgt.dispatchEvent(new Event('change'))
    await flush()
    expect(cfg.general.targetLang).toBe('ja')
    expect(tabMessages.some((m) => m.msg.kind === 'configChanged')).toBe(true)
  })
})

describe('popup i18n（uiLang）', () => {
  it('zh-CN：行标签/按钮/状态文案与中文现状一致', async () => {
    const app = await mount(DEFAULT_CONFIG)
    expect(rowLabel(app, 'engine')).toBe('翻译引擎')
    expect(rowLabel(app, 'expert')).toBe('AI 专家')
    expect(rowLabel(app, 'displayMode')).toBe('显示模式')
    expect(rowLabel(app, 'style')).toBe('译文样式')
    expect(rowLabel(app, 'hover')).toBe('悬停翻译')
    expect(rowLabel(app, 'selection')).toBe('划词翻译')
    expect(rowLabel(app, 'floatingBall')).toBe('悬浮球')
    expect(app.querySelector('.site-rules-label')?.textContent).toBe('当前网站')
    expect(app.querySelector('.main-btn')?.textContent).toBe('翻译此页')
    expect(app.querySelector('.status-text')?.textContent).toBe('此页面不可用')
    const btns = Array.from(app.querySelectorAll('.review-btn')).map((b) => b.textContent)
    expect(btns).toEqual(['文档翻译', '开始复习'])
    expect(app.querySelector('.stats-text')?.textContent).toBe('生词 3 · 到期 2')
    // 显示模式选项
    const modeSel = app.querySelector('.row[data-row="displayMode"] select') as HTMLSelectElement
    expect(Array.from(modeSel.options).map((o) => o.textContent)).toEqual(['双语对照', '仅译文'])
    // 源语言下拉首项为自动检测
    const src = app.querySelector('select[data-lang-kind="source"]') as HTMLSelectElement
    expect(src.options[0].textContent).toBe('自动检测')
  })

  it('uiLang=en：行标签/按钮/状态文案变英文', async () => {
    const enCfg = clone(DEFAULT_CONFIG)
    enCfg.uiLang = 'en'
    const app = await mount(enCfg)
    expect(rowLabel(app, 'engine')).toBe('Translation engine')
    expect(rowLabel(app, 'expert')).toBe('AI expert')
    expect(rowLabel(app, 'displayMode')).toBe('Display mode')
    expect(rowLabel(app, 'style')).toBe('Translation style')
    expect(rowLabel(app, 'hover')).toBe('Hover translation')
    expect(rowLabel(app, 'selection')).toBe('Selection translation')
    expect(rowLabel(app, 'floatingBall')).toBe('Floating ball')
    expect(app.querySelector('.site-rules-label')?.textContent).toBe('Current site')
    expect(app.querySelector('.main-btn')?.textContent).toBe('Translate this page')
    expect(app.querySelector('.status-text')?.textContent).toBe('Unavailable on this page')
    const btns = Array.from(app.querySelectorAll('.review-btn')).map((b) => b.textContent)
    expect(btns).toEqual(['Document translation', 'Start review'])
    expect(app.querySelector('.stats-text')?.textContent).toBe('Words 3 · Due 2')
    const modeSel = app.querySelector('.row[data-row="displayMode"] select') as HTMLSelectElement
    expect(Array.from(modeSel.options).map((o) => o.textContent)).toEqual([
      'Bilingual',
      'Translation only',
    ])
    const src = app.querySelector('select[data-lang-kind="source"]') as HTMLSelectElement
    expect(src.options[0].textContent).toBe('Auto-detect')
  })
})
