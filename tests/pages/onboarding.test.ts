// @vitest-environment jsdom
/**
 * onboarding（首次安装引导）页测试：jsdom 起真实页面 + chrome stub，断言：
 * - 三步导航：下一步 / 上一步 / 完成 在三个步骤卡片间正确切换，进度条当前步高亮
 * - 设置即改即存：改目标语言 / 显示模式 / 翻译引擎后 stub 立即收到 {kind:'setConfig',patch}
 * - 完成按钮写入 onboardingCompleted: true 并显示完成态
 * - i18n：uiLang=en / ja 文案正确；storage tv:config_v1 中 uiLang 变化时即时重渲染
 * - Step 3 选中示例文本后触发 {kind:'translate'} 消息并显示译文
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import type { BgRequest } from '../../src/shared/protocol'

const SAMPLE = 'The best way to learn a language is to read what you love.'

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void

interface BootResult {
  sent: BgRequest[]
  storageListener: StorageListener | null
}

let currentConfig: Config

/** 每个用例一套全新模块状态 + DOM + 桩；getConfig 返回指定 uiLang */
async function boot(uiLang: string): Promise<BootResult> {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  const sent: BgRequest[] = []
  let storageListener: StorageListener | null = null
  currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config
  currentConfig.uiLang = uiLang

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => p,
      sendMessage: (msg: BgRequest) => {
        sent.push(msg)
        if (msg.kind === 'getConfig') {
          return Promise.resolve({ ok: true, data: currentConfig })
        }
        if (msg.kind === 'setConfig') {
          currentConfig = { ...currentConfig, ...msg.patch }
          return Promise.resolve({ ok: true, data: currentConfig })
        }
        if (msg.kind === 'translate') {
          return Promise.resolve({ ok: true, data: { text: `译文：${msg.text}` } })
        }
        return Promise.resolve({ ok: false, error: '未知消息' })
      },
    },
    storage: {
      onChanged: {
        addListener: (cb: StorageListener) => {
          storageListener = cb
        },
      },
    },
  })
  await import('../../src/onboarding/main')
  // 等配置加载、首屏渲染完成
  await vi.waitFor(() => {
    expect(document.querySelector('.ob-card')).toBeTruthy()
  })
  return { sent, storageListener }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ===== DOM 小工具 =====

function q<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector(sel)
  if (!node) throw new Error(`找不到元素 ${sel}`)
  return node as T
}

function setConfigPatches(sent: BgRequest[]): Array<Extract<BgRequest, { kind: 'setConfig' }>> {
  return sent.filter((m): m is Extract<BgRequest, { kind: 'setConfig' }> => m.kind === 'setConfig')
}

/** 当前高亮的进度段序号（1-based） */
function activeSeg(): number {
  const segs = Array.from(document.querySelectorAll('.ob-progress-seg'))
  const idx = segs.findIndex((s) => s.classList.contains('is-active'))
  return idx + 1
}

describe('onboarding 页', () => {
  it('三步导航：下一步 / 上一步在三个步骤间切换，进度条同步高亮', async () => {
    await boot('zh-CN')

    // Step 1：欢迎与基础设置
    expect(q('.ob-step-title').textContent).toBe('欢迎使用 Rtranslate')
    expect(document.querySelector('.ob-target-lang')).toBeTruthy()
    expect(document.querySelector('.ob-engine-btn')).toBeTruthy()
    expect(document.querySelectorAll('input[name="ob-display-mode"]')).toHaveLength(2)
    expect(activeSeg()).toBe(1)
    expect(document.querySelector('.ob-prev')).toBeNull()

    // → Step 2：固定到工具栏
    q<HTMLButtonElement>('.ob-next').click()
    expect(q('.ob-step-title').textContent).toBe('把 Rtranslate 固定到工具栏')
    expect(document.querySelectorAll('.ob-pin-step')).toHaveLength(3)
    expect(activeSeg()).toBe(2)

    // → Step 3：交互初体验
    q<HTMLButtonElement>('.ob-next').click()
    expect(q('.ob-step-title').textContent).toBe('试试划词翻译')
    expect(q('.ob-sample-text').textContent).toBe(SAMPLE)
    expect(q('.ob-finish').textContent).toBe('完成设置，开始使用')
    expect(activeSeg()).toBe(3)

    // ← 返回 Step 2 → 返回 Step 1
    q<HTMLButtonElement>('.ob-prev').click()
    expect(q('.ob-step-title').textContent).toBe('把 Rtranslate 固定到工具栏')
    expect(activeSeg()).toBe(2)
    q<HTMLButtonElement>('.ob-prev').click()
    expect(q('.ob-step-title').textContent).toBe('欢迎使用 Rtranslate')
    expect(activeSeg()).toBe(1)
  })

  it('设置即改即存：改目标语言后立即收到 setConfig patch', async () => {
    const { sent } = await boot('zh-CN')

    const sel = q<HTMLSelectElement>('.ob-target-lang')
    expect(sel.value).toBe('zh-CN') // 默认 config.general.targetLang
    sel.value = 'ja'
    sel.dispatchEvent(new Event('change'))

    await vi.waitFor(() => {
      const patches = setConfigPatches(sent)
      expect(patches.some((m) => m.patch.general?.targetLang === 'ja')).toBe(true)
    })
    // 与 popup 同一存储键：整对象 general 展开写入
    const patch = setConfigPatches(sent).find((m) => m.patch.general?.targetLang === 'ja')
    expect(patch?.patch.general?.sourceLang).toBe('auto')
  })

  it('设置即改即存：显示模式单选卡片与引擎下拉（带 16px 图标）', async () => {
    const { sent } = await boot('zh-CN')

    // 显示模式：默认双语对照，切到仅译文
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="ob-display-mode"]'),
    )
    const bilingual = radios.find((r) => r.value === 'bilingual')
    const translationOnly = radios.find((r) => r.value === 'translationOnly')
    expect(bilingual?.checked).toBe(true)
    translationOnly?.click()
    await vi.waitFor(() => {
      expect(
        setConfigPatches(sent).some((m) => m.patch.general?.displayMode === 'translationOnly'),
      ).toBe(true)
    })

    // 引擎：默认 google（DEFAULT_CONFIG），按钮带 16px 图标；AI猫在列表第一位
    const engineBtn = q<HTMLButtonElement>('.ob-engine-btn')
    const btnIcon = engineBtn.querySelector<HTMLImageElement>('.ob-engine-icon')
    expect(btnIcon?.getAttribute('src')).toBe('engine-icons/google.svg')
    expect(btnIcon?.width).toBe(16)
    engineBtn.click()
    const items = Array.from(document.querySelectorAll<HTMLElement>('.ob-engine-item'))
    expect(items[0]?.dataset.engineId).toBe('aimao')
    expect(items[0]?.querySelector('.ob-engine-icon')?.getAttribute('src')).toBe(
      'engine-icons/aimao.png',
    )

    // 选择 DeepL → 立即收到 engine.provider patch
    const deepl = items.find((i) => i.dataset.engineId === 'deepl')
    deepl?.click()
    await vi.waitFor(() => {
      expect(
        setConfigPatches(sent).some((m) => m.patch.engine?.provider === 'deepl'),
      ).toBe(true)
    })
    // 重渲染后按钮显示 DeepL
    expect(q('.ob-engine-btn .ob-engine-name').textContent).toBe('DeepL')
  })

  it('完成按钮写入 onboardingCompleted: true 并显示完成态', async () => {
    const { sent } = await boot('zh-CN')
    q<HTMLButtonElement>('.ob-next').click()
    q<HTMLButtonElement>('.ob-next').click()
    q<HTMLButtonElement>('.ob-finish').click()

    await vi.waitFor(() => {
      expect(
        setConfigPatches(sent).some((m) => m.patch.onboardingCompleted === true),
      ).toBe(true)
    })
    await vi.waitFor(() => {
      expect(q('.ob-done-title').textContent).toBe('一切就绪！')
    })
    expect(q('.ob-done-desc').textContent).toBe('可以关闭此标签页，去任意英文网页试试。')
    // 完成态不再显示步骤操作按钮
    expect(document.querySelector('.ob-next')).toBeNull()
    expect(document.querySelector('.ob-finish')).toBeNull()
  })

  it('i18n：uiLang=en 时三步文案为英文', async () => {
    await boot('en')

    expect(q('.ob-step-title').textContent).toBe('Welcome to Rtranslate')
    expect(q('.ob-next').textContent).toBe('Next')
    const labels = Array.from(document.querySelectorAll('.ob-field-label')).map(
      (n) => n.textContent,
    )
    expect(labels).toEqual(['Target language', 'Translation engine', 'Display mode'])
    const radioLabels = Array.from(document.querySelectorAll('.ob-radio-label')).map(
      (n) => n.textContent,
    )
    expect(radioLabels).toEqual(['Bilingual', 'Translation only'])

    q<HTMLButtonElement>('.ob-next').click()
    expect(q('.ob-step-title').textContent).toBe('Pin Rtranslate to the toolbar')
    expect(q('.ob-prev').textContent).toBe('Back')

    q<HTMLButtonElement>('.ob-next').click()
    expect(q('.ob-step-title').textContent).toBe('Try selection translation')
    expect(q('.ob-finish').textContent).toBe('Finish setup and start')
    expect(q('.ob-demo-result').textContent).toBe(
      'Select the sample text and the translation will appear here',
    )
  })

  it('i18n：uiLang=ja 时文案为日文，storage 中 uiLang 变化时即时重渲染', async () => {
    const { storageListener } = await boot('ja')

    expect(q('.ob-step-title').textContent).toBe('Rtranslate へようこそ')
    expect(q('.ob-next').textContent).toBe('次へ')
    if (!storageListener) throw new Error('storage.onChanged 监听未注册')

    // 切到英文：当前步立即按英文重渲染
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'en' } } }, 'local')
    expect(q('.ob-step-title').textContent).toBe('Welcome to Rtranslate')
    expect(q('.ob-next').textContent).toBe('Next')

    // 切回日文
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'ja' } } }, 'local')
    expect(q('.ob-step-title').textContent).toBe('Rtranslate へようこそ')
  })

  it('选中示例文本后触发 translate 消息并显示译文；清空选择回到引导提示', async () => {
    const { sent } = await boot('zh-CN')
    q<HTMLButtonElement>('.ob-next').click()
    q<HTMLButtonElement>('.ob-next').click()

    // 未选中：显示引导提示，未发翻译消息
    expect(q('.ob-demo-result').textContent).toBe('选中示例文本后，译文会实时显示在这里')
    expect(sent.some((m) => m.kind === 'translate')).toBe(false)

    // 选中示例文本
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => SAMPLE } as Selection)
    document.dispatchEvent(new Event('selectionchange'))

    await vi.waitFor(() => {
      const translateMsgs = sent.filter(
        (m): m is Extract<BgRequest, { kind: 'translate' }> => m.kind === 'translate',
      )
      expect(translateMsgs).toHaveLength(1)
      expect(translateMsgs[0].text).toBe(SAMPLE)
      expect(translateMsgs[0].targetLang).toBe('zh-CN')
    })
    await vi.waitFor(() => {
      expect(q('.ob-demo-result').textContent).toBe(`译文：${SAMPLE}`)
    })

    // 清空选择：回到引导提示
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    document.dispatchEvent(new Event('selectionchange'))
    expect(q('.ob-demo-result').textContent).toBe('选中示例文本后，译文会实时显示在这里')
  })
})
