// @vitest-environment jsdom
/**
 * files（文档翻译）页 i18n 测试：jsdom 起真实页面，stub getConfig 返回不同 uiLang，断言：
 * - uiLang=en / ja / zh-CN 时，品牌标题、上传区（主文案/格式说明/按钮）、
 *   翻译设置卡片、开始翻译按钮、校订卡片等文案随界面语言正确切换
 * - storage tv:config_v1 中 uiLang 变化时，页面按新语言即时重渲染（watchUiLang）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void

interface BootResult {
  storageListener: StorageListener | null
}

/** 每个用例一套全新模块状态 + DOM + 桩；getConfig 返回指定 uiLang */
async function boot(uiLang: string): Promise<BootResult> {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  let storageListener: StorageListener | null = null
  // parsers/index 连带加载 pdf.ts（顶层用 chrome.runtime.getURL），需先打桩
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => p,
      sendMessage: (msg: { kind: string }) => {
        if (msg.kind === 'getConfig') {
          return Promise.resolve({
            ok: true,
            data: { uiLang, general: { targetLang: 'zh-CN' } },
          })
        }
        return Promise.resolve({ ok: false, error: `未知消息 ${msg.kind}` })
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
  await import('../../src/files/main')
  return { storageListener }
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

/** 卡片标题（按出现顺序：0=文件选择 1=翻译设置 2=开始翻译 3=校订译文） */
function cardTitle(idx: number): string {
  const titles = document.querySelectorAll('.card-title')
  const node = titles[idx]
  if (!node) throw new Error(`找不到第 ${idx} 个卡片标题`)
  return node.textContent ?? ''
}

/** 等配置加载、页面按 uiLang 重渲染完成（以品牌标题为标志） */
async function waitBrand(text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(q('.brand-name').textContent).toBe(text)
  })
}

describe('files 页 i18n', () => {
  it('uiLang=en：标题/上传区/按钮等文案为英文', async () => {
    await boot('en')
    await waitBrand('Rtranslate · Document Translation')

    // 上传区
    expect(cardTitle(0)).toBe('Choose file')
    expect(q('.dropzone-main').textContent).toBe('Drag & drop a file here')
    expect(q('.dropzone-sub').textContent).toContain('Supports')
    expect(q('.dropzone-sub').textContent).toContain('.txt')
    expect(q('.dropzone-sub').textContent).toContain('per file')
    expect(q('.dropzone-btn').textContent).toBe('Click to choose a file')

    // 翻译设置卡片
    expect(cardTitle(1)).toBe('Translation settings')
    const labels = Array.from(document.querySelectorAll('.field-label')).map((n) => n.textContent)
    expect(labels).toEqual(['Target language', 'Output mode'])
    const radioLabels = Array.from(document.querySelectorAll('.radio-label')).map(
      (n) => n.textContent,
    )
    expect(radioLabels).toEqual(['Bilingual', 'Translation only'])
    const radioDescs = Array.from(document.querySelectorAll('.radio-desc')).map(
      (n) => n.textContent,
    )
    expect(radioDescs[0]).toBe('Original and translation side by side for easy proofreading')
    expect(radioDescs[1]).toBe('Keep only the translation for a cleaner layout')

    // 开始翻译卡片 + 按钮
    expect(cardTitle(2)).toBe('Start translation')
    expect(q('.actions .btn').textContent).toBe('Translate')

    // 校订卡片（隐藏但已在 DOM 中）
    expect(cardTitle(3)).toBe('Post-edit translation')
    expect(q('.pe-toggle-text').textContent).toBe('Post-edit mode')
    expect(q('.pe-count').textContent).toBe('Edited 0 / 0 segments')
  })

  it('uiLang=ja：标题/上传区/按钮等文案为日文', async () => {
    await boot('ja')
    await waitBrand('Rtranslate · ドキュメント翻訳')

    expect(cardTitle(0)).toBe('ファイルを選択')
    expect(q('.dropzone-main').textContent).toBe('ここにファイルをドラッグ')
    expect(q('.dropzone-btn').textContent).toBe('クリックしてファイルを選択')
    expect(cardTitle(1)).toBe('翻訳設定')
    expect(cardTitle(2)).toBe('翻訳を開始')
    expect(q('.actions .btn').textContent).toBe('翻訳開始')
    expect(cardTitle(3)).toBe('訳文を校訂')
    expect(q('.pe-toggle-text').textContent).toBe('校訂モード')
  })

  it('uiLang=zh-CN：文案回退中文原文', async () => {
    await boot('zh-CN')
    await waitBrand('Rtranslate · 文档翻译')

    expect(cardTitle(0)).toBe('选择文件')
    expect(q('.dropzone-main').textContent).toBe('拖拽文件到这里')
    expect(q('.dropzone-sub').textContent).toContain('支持')
    expect(q('.dropzone-sub').textContent).toContain('单个文件不超过')
    expect(q('.dropzone-btn').textContent).toBe('点击选择文件')
    expect(cardTitle(1)).toBe('翻译设置')
    expect(cardTitle(2)).toBe('开始翻译')
    expect(q('.actions .btn').textContent).toBe('开始翻译')
    expect(cardTitle(3)).toBe('校订译文')
    expect(q('.pe-toggle-text').textContent).toBe('校订模式')
    expect(q('.pe-count').textContent).toBe('已校订 0 / 共 0 段')
  })

  it('storage 中 uiLang 变化时按新语言即时重渲染', async () => {
    const { storageListener } = await boot('zh-CN')
    await waitBrand('Rtranslate · 文档翻译')
    if (!storageListener) throw new Error('storage.onChanged 监听未注册')

    // 切到英文：标题/上传区/按钮立即变为英文
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'en' } } }, 'local')
    expect(q('.brand-name').textContent).toBe('Rtranslate · Document Translation')
    expect(q('.dropzone-main').textContent).toBe('Drag & drop a file here')
    expect(q('.dropzone-btn').textContent).toBe('Click to choose a file')
    expect(q('.actions .btn').textContent).toBe('Translate')
    expect(q('.pe-count').textContent).toBe('Edited 0 / 0 segments')

    // 切到日文
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'ja' } } }, 'local')
    expect(q('.brand-name').textContent).toBe('Rtranslate · ドキュメント翻訳')
    expect(q('.dropzone-main').textContent).toBe('ここにファイルをドラッグ')

    // sync 之外的变化（非 local 命名空间）不触发重渲染
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'en' } } }, 'sync')
    expect(q('.brand-name').textContent).toBe('Rtranslate · ドキュメント翻訳')

    // 切回中文
    storageListener({ 'tv:config_v1': { newValue: { uiLang: 'zh-CN' } } }, 'local')
    expect(q('.brand-name').textContent).toBe('Rtranslate · 文档翻译')
    expect(q('.actions .btn').textContent).toBe('开始翻译')
  })
})
