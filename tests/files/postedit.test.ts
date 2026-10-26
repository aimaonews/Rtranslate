// @vitest-environment jsdom
/**
 * 校订（Post-Editing）端到端测试：jsdom 起真实页面，stub chrome.runtime.sendMessage
 * 模拟机翻（'T:' 前缀），走「选文件 → 翻译 → 校订 → 下载」完整链路，断言：
 * - 翻译完成后出现校订卡片，开关默认关、计数 0
 * - 编辑实时写回 translations Map，"已校订 X / 共 N 段"计数随编辑/还原变化
 * - 下载时 parser.build 收到校订后的文本（读取导出的 Blob 内容验证）
 * - 校订模式开关来回切换不丢已编辑内容
 * - 重新翻译重置校订并 toast 提示
 * - 超过 200 段仅渲染前 200 段并提示
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type MainModule = typeof import('../../src/files/main')

interface BootResult {
  mod: MainModule
  /** URL.createObjectURL 收到的 Blob（即 parser.build 的产物） */
  createdBlobs: Blob[]
  /** 拦截 a.click() 的 spy，用于读下载文件名并避免 jsdom 导航告警 */
  clickSpy: ReturnType<typeof vi.spyOn>
}

/** jsdom 的 Blob/File 未实现 arrayBuffer()/text()，用 FileReader 补齐（幂等） */
function polyfillBlobReads(): void {
  const readAs = (blob: Blob, mode: 'arrayBuffer' | 'text'): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error as unknown)
      if (mode === 'arrayBuffer') r.readAsArrayBuffer(blob)
      else r.readAsText(blob)
    })
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return readAs(this, 'arrayBuffer') as Promise<ArrayBuffer>
    }
  }
  if (typeof Blob.prototype.text !== 'function') {
    Blob.prototype.text = function (this: Blob) {
      return readAs(this, 'text') as Promise<string>
    }
  }
}

/** 每个用例一套全新模块状态 + DOM + 桩 */
async function boot(): Promise<BootResult> {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  polyfillBlobReads()
  // parsers/index 连带加载 pdf.ts（顶层用 chrome.runtime.getURL），需先打桩
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => p,
      sendMessage: (msg: { kind: string; texts?: string[] }) => {
        if (msg.kind === 'getConfig') {
          return Promise.resolve({ ok: true, data: { uiLang: 'zh-CN', general: { targetLang: 'zh-CN' } } })
        }
        if (msg.kind === 'translateBatch') {
          return Promise.resolve({ ok: true, data: (msg.texts ?? []).map((t) => `T:${t}`) })
        }
        return Promise.resolve({ ok: false, error: `未知消息 ${msg.kind}` })
      },
    },
  })
  const createdBlobs: Blob[] = []
  const urlHost = URL as unknown as Record<string, unknown>
  urlHost.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob)
    return `blob:mock-${createdBlobs.length}`
  })
  urlHost.revokeObjectURL = vi.fn()
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const mod = await import('../../src/files/main')
  return { mod, createdBlobs, clickSpy }
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

function btnByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement | undefined
  if (!btn) throw new Error(`找不到按钮 ${text}`)
  return btn
}

function peToggleEl(): HTMLInputElement {
  return q<HTMLInputElement>('.pe-card .switch')
}

function peInputs(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll('.pe-input'))
}

function editSegment(idx: number, text: string): void {
  const ta = peInputs()[idx]
  ta.value = text
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function dropFile(file: File): void {
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } })
  q('.dropzone').dispatchEvent(ev)
}

/** 选文件 → 点开始翻译 → 等下载按钮出现（翻译完成） */
async function translateFile(name: string, content: string): Promise<void> {
  dropFile(new File([content], name))
  btnByText('开始翻译').click()
  await vi.waitFor(() => {
    expect(btnByText('下载译文').style.display).toBe('')
  })
}

const THREE_PARAS = 'Hello world one\n\nHello world two\n\nHello world three'

describe('校订（Post-Editing）', () => {
  it('翻译完成后出现校订卡片：开关默认关、计数 0、列表不渲染', async () => {
    const { mod } = await boot()
    await translateFile('demo.txt', THREE_PARAS)
    expect(q('.pe-card').style.display).toBe('')
    expect(peToggleEl().checked).toBe(false)
    expect(q('.pe-list').style.display).toBe('none')
    expect(peInputs()).toHaveLength(0)
    expect(q('.pe-count').textContent).toBe('已校订 0 / 共 3 段')
    expect(mod.__getStateForTest()?.translations?.size).toBe(3)
  })

  it('编辑实时写回 translations 并更新已校订计数；改回机翻则取消计数', async () => {
    const { mod } = await boot()
    await translateFile('demo.txt', THREE_PARAS)
    peToggleEl().click()
    const inputs = peInputs()
    expect(inputs).toHaveLength(3)
    // 初始值为机翻结果
    expect(inputs[0].value).toBe('T:Hello world one')

    editSegment(0, '人工改译一')
    const st = mod.__getStateForTest()
    expect(st?.translations?.get(0)).toBe('人工改译一')
    expect(st?.edited.size).toBe(1)
    expect(q('.pe-count').textContent).toBe('已校订 1 / 共 3 段')

    editSegment(2, '人工改译三')
    expect(q('.pe-count').textContent).toBe('已校订 2 / 共 3 段')

    // 改回机翻基线 → 不再计为已校订
    editSegment(0, 'T:Hello world one')
    const st2 = mod.__getStateForTest()
    expect(st2?.edited.size).toBe(1)
    expect(st2?.edited.has(0)).toBe(false)
    expect(q('.pe-count').textContent).toBe('已校订 1 / 共 3 段')
  })

  it('下载时 build 收到校订后的文本', async () => {
    const { createdBlobs, clickSpy } = await boot()
    await translateFile('demo.txt', 'Hello world one\n\nHello world two')
    peToggleEl().click()
    editSegment(0, '人工改译一')

    btnByText('下载译文').click()
    await vi.waitFor(() => {
      expect(q('.status').textContent).toContain('已导出')
    })
    expect(q('.status').textContent).toContain('含 1 段校订')

    const blob = createdBlobs.at(-1)
    expect(blob).toBeDefined()
    const text = await (blob as Blob).text()
    // 双语模式：原文保留 + 校订后译文；未校订段仍用机翻
    expect(text).toContain('Hello world one')
    expect(text).toContain('人工改译一')
    expect(text).not.toContain('T:Hello world one')
    expect(text).toContain('T:Hello world two')

    // 下载文件名沿用「base_已翻译.ext」
    const anchor = clickSpy.mock.instances.at(-1) as HTMLAnchorElement
    expect(anchor.download).toBe('demo_已翻译.txt')
  })

  it('校订模式开关来回切换不丢已编辑内容', async () => {
    const { mod } = await boot()
    await translateFile('demo.txt', 'Hello world one\n\nHello world two')
    const toggle = peToggleEl()
    toggle.click()
    editSegment(1, '人工改译二')

    toggle.click() // 关：列表收起
    expect(q('.pe-list').style.display).toBe('none')
    toggle.click() // 再开：从 translations Map 重渲染，编辑仍在
    expect(peInputs()[1].value).toBe('人工改译二')
    expect(mod.__getStateForTest()?.translations?.get(1)).toBe('人工改译二')
    expect(q('.pe-count').textContent).toBe('已校订 1 / 共 2 段')
  })

  it('重新翻译重置校订并提示', async () => {
    const { mod } = await boot()
    await translateFile('demo.txt', 'Hello world one\n\nHello world two')
    peToggleEl().click()
    editSegment(0, '人工改译一')
    expect(mod.__getStateForTest()?.edited.size).toBe(1)

    btnByText('开始翻译').click()
    // 提示同步出现（toast 在首个 await 之前触发）
    expect(q('.toast').textContent).toContain('清空')
    // 等第二轮翻译完成：translations 被机翻结果覆盖是完成态的可靠标志
    await vi.waitFor(() => {
      expect(mod.__getStateForTest()?.translations?.get(0)).toBe('T:Hello world one')
    })
    const st = mod.__getStateForTest()
    expect(st?.edited.size).toBe(0)
    expect(peToggleEl().checked).toBe(false)
    expect(q('.pe-list').style.display).toBe('none')
    expect(q('.pe-count').textContent).toBe('已校订 0 / 共 2 段')
  })

  it('超过 200 段：仅渲染前 200 段并提示，校订仍正常写回', async () => {
    const { mod } = await boot()
    const paras = Array.from({ length: 201 }, (_, i) => `Hello paragraph number ${i + 1}`)
    await translateFile('big.txt', paras.join('\n\n'))

    peToggleEl().click()
    expect(peInputs()).toHaveLength(mod.PE_MAX_SEGMENTS)
    const hint = q('.pe-hint')
    expect(hint.style.display).toBe('')
    expect(hint.textContent).toBe('仅显示前 200 段校订')
    expect(q('.pe-count').textContent).toBe('已校订 0 / 共 201 段')

    editSegment(0, '改')
    expect(mod.__getStateForTest()?.translations?.get(0)).toBe('改')
    expect(q('.pe-count').textContent).toBe('已校订 1 / 共 201 段')
  })
})
