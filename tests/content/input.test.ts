// @vitest-environment jsdom
// 输入框翻译写回（三级降级）测试：mock 各级成功/失败路径，验证降级顺序与最终值。
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { smartReplaceText, initInput } from '../../src/content/input'
import type { Config } from '../../src/shared/config'

// ---------- jsdom 缺失 API polyfill（仅在本文件全局环境缺省时注入） ----------
class TestDataTransfer {
  private store = new Map<string, string>()
  setData(type: string, val: string) {
    this.store.set(type, val)
  }
  getData(type: string) {
    return this.store.get(type) ?? ''
  }
}
class TestClipboardEvent extends Event {
  clipboardData: TestDataTransfer | null
  constructor(type: string, init?: EventInit & { clipboardData?: TestDataTransfer }) {
    super(type, init)
    this.clipboardData = init?.clipboardData ?? null
  }
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  if (typeof g.DataTransfer === 'undefined') g.DataTransfer = TestDataTransfer
  if (typeof g.ClipboardEvent === 'undefined') g.ClipboardEvent = TestClipboardEvent
})

// ---------- 通用夹具 ----------
type ExecCommandFn = (cmd: string, showUI?: boolean, value?: string) => boolean
let execCommandSpy: ReturnType<typeof vi.fn<ExecCommandFn>>

beforeEach(() => {
  document.body.innerHTML = ''
  // jsdom 未实现 execCommand；默认 stub 为失败（触发降级）
  execCommandSpy = vi.fn<ExecCommandFn>(() => false)
  document.execCommand = execCommandSpy as unknown as Document['execCommand']
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeConfig(trigger: 'altEnter' | 'tripleSpace'): Config {
  return {
    input: { enabled: true, trigger, targetLang: 'zh-CN' },
  } as unknown as Config
}

function mockChromeSendMessage(impl: () => Promise<unknown>) {
  const sendMessage = vi.fn(impl)
  ;(globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage } }
  return sendMessage
}

function makeContentEditable(text: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('contenteditable', 'true')
  el.textContent = text
  document.body.appendChild(el)
  return el
}

function makeInput(text: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = text
  document.body.appendChild(input)
  return input
}

const insertTextCalls = () => execCommandSpy.mock.calls.filter((c) => c[0] === 'insertText')

// ---------- 三级降级 ----------
describe('smartReplaceText：contenteditable 富文本', () => {
  it('第 1 级 paste 成功时不再进入第 2/3 级', async () => {
    const el = makeContentEditable('old text')
    const order: string[] = []
    el.addEventListener('paste', (e) => {
      order.push('paste')
      // 模拟富文本编辑器处理 paste：从 clipboardData 取文本写入
      const dt = (e as ClipboardEvent).clipboardData
      el.textContent = dt?.getData('text/plain') ?? ''
    })
    el.addEventListener('input', () => order.push('input'))

    const ok = await smartReplaceText(el, '译文')

    expect(ok).toBe(true)
    expect(el.textContent).toBe('译文')
    expect(order).toEqual(['paste']) // 无第 3 级的 input 事件
    expect(insertTextCalls()).toHaveLength(0) // 未走 execCommand
  })

  it('第 1 级 paste 无人处理时降级到第 2 级 execCommand', async () => {
    const el = makeContentEditable('old text')
    const order: string[] = []
    el.addEventListener('paste', () => order.push('paste')) // 监听但不修改内容 → 验证失败
    el.addEventListener('input', () => order.push('input'))
    execCommandSpy.mockImplementation((cmd, _showUI, value) => {
      if (cmd === 'insertText') {
        order.push('exec')
        el.textContent = String(value)
        return true
      }
      return true
    })

    const ok = await smartReplaceText(el, '译文')

    expect(ok).toBe(true)
    expect(el.textContent).toBe('译文')
    expect(order).toEqual(['paste', 'exec']) // 降级顺序 1 → 2，且未到第 3 级
    expect(insertTextCalls()).toHaveLength(1)
  })

  it('第 1/2 级都失败时第 3 级 textContent + InputEvent 兜底', async () => {
    const el = makeContentEditable('old text')
    const order: string[] = []
    el.addEventListener('paste', () => order.push('paste'))
    const inputEvents: Event[] = []
    el.addEventListener('input', (e) => {
      order.push('input')
      inputEvents.push(e)
    })
    execCommandSpy.mockImplementation((cmd) => {
      if (cmd === 'insertText') order.push('exec')
      return false
    })

    const ok = await smartReplaceText(el, '译文')

    expect(ok).toBe(true)
    expect(el.textContent).toBe('译文')
    expect(order).toEqual(['paste', 'exec', 'input']) // 完整降级链
    expect(inputEvents).toHaveLength(1)
    expect(inputEvents[0].type).toBe('input')
    expect(inputEvents[0].bubbles).toBe(true)
  })
})

describe('smartReplaceText：input/textarea', () => {
  it('第 2 级 execCommand 成功时不走原生 setter（无 input/change 事件）', async () => {
    const input = makeInput('old')
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    execCommandSpy.mockImplementation((cmd, _showUI, value) => {
      if (cmd === 'insertText') {
        input.value = String(value)
        return true
      }
      return true
    })

    const ok = await smartReplaceText(input, '译文')

    expect(ok).toBe(true)
    expect(input.value).toBe('译文')
    expect(events).toEqual([]) // 第 3 级未触发
  })

  it('第 2 级失败时第 3 级：原生原型 setter + input + change，且顺序在 execCommand 之后', async () => {
    const input = makeInput('old')
    const order: string[] = []
    execCommandSpy.mockImplementation((cmd) => {
      if (cmd === 'insertText') order.push('exec')
      return false
    })
    input.addEventListener('input', () => order.push('input'))
    input.addEventListener('change', () => order.push('change'))

    // 包一层原型 setter 以观察第 3 级是否走了原生 setter
    const proto = HTMLInputElement.prototype
    const origDesc = Object.getOwnPropertyDescriptor(proto, 'value')!
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get: origDesc.get,
      set(this: HTMLInputElement, v: string) {
        if (this === input) order.push('native-set')
        origDesc.set!.call(this, v)
      },
    })
    try {
      const ok = await smartReplaceText(input, '译文')
      expect(ok).toBe(true)
      expect(input.value).toBe('译文')
      expect(order).toEqual(['exec', 'native-set', 'input', 'change'])
    } finally {
      Object.defineProperty(proto, 'value', origDesc)
    }
  })

  it('textarea 走 HTMLTextAreaElement 原生 setter', async () => {
    const ta = document.createElement('textarea')
    ta.value = 'old'
    document.body.appendChild(ta)
    const events: string[] = []
    ta.addEventListener('input', () => events.push('input'))
    ta.addEventListener('change', () => events.push('change'))

    const ok = await smartReplaceText(ta, '译文')

    expect(ok).toBe(true)
    expect(ta.value).toBe('译文')
    expect(events).toEqual(['input', 'change'])
  })

  it('React 式 value 劫持：实例重写 value setter 后原生 setter 仍能写入', async () => {
    const input = makeInput('old')
    const nativeGet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!
    const hijackSetCalls: string[] = []
    // 模拟 React/受控组件：实例上重写 value，setter 吞掉写入
    Object.defineProperty(input, 'value', {
      configurable: true,
      get(this: HTMLInputElement) {
        return nativeGet.call(this)
      },
      set(this: HTMLInputElement, v: string) {
        hijackSetCalls.push(String(v)) // 不写入底层
      },
    })
    let inputEventFired = false
    input.addEventListener('input', () => {
      inputEventFired = true
    })

    const ok = await smartReplaceText(input, 'React 译文')

    expect(ok).toBe(true)
    expect(input.value).toBe('React 译文') // 原生 setter 绕过劫持写入
    expect(hijackSetCalls).toEqual([]) // 劫持 setter 未被用于写入
    expect(inputEventFired).toBe(true) // React 靠 input 事件同步 state
  })
})

// ---------- 触发链路与提示条 ----------
describe('触发与提示（Alt+Enter / 三连空格）', () => {
  it('Alt+Enter 触发翻译并写回，成功提示', async () => {
    const input = makeInput('hello')
    const sendMessage = mockChromeSendMessage(async () => ({ ok: true, data: { text: '你好' } }))
    initInput(makeConfig('altEnter'))

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(input.value).toBe('你好'))
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'translate', text: 'hello', targetLang: 'zh-CN' }),
    )
    await vi.waitFor(() =>
      expect(document.querySelector('.tv-input-tip')?.textContent).toBe('已翻译并替换'),
    )
  })

  it('翻译失败时提示不变且原值不动', async () => {
    const input = makeInput('hello')
    mockChromeSendMessage(async () => ({ ok: false, error: '引擎超时' }))
    initInput(makeConfig('altEnter'))

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }))

    await vi.waitFor(() =>
      expect(document.querySelector('.tv-input-tip')?.textContent).toBe('翻译失败：引擎超时'),
    )
    expect(input.value).toBe('hello')
  })

  it('三连空格触发翻译并写回', async () => {
    const input = makeInput('hello')
    const sendMessage = mockChromeSendMessage(async () => ({ ok: true, data: { text: '你好' } }))
    initInput(makeConfig('tripleSpace'))

    // 先敲一个普通键重置模块内计数，再三连空格
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    for (let i = 0; i < 3; i++) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    }

    await vi.waitFor(() => expect(input.value).toBe('你好'))
    expect(sendMessage).toHaveBeenCalledTimes(1)
    await vi.waitFor(() =>
      expect(document.querySelector('.tv-input-tip')?.textContent).toBe('已翻译并替换'),
    )
  })
})
