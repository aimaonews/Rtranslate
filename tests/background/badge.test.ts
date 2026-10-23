import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------- mock：chrome.action / chrome.tabs / 消息监听器捕获 ----------
// background 入口在 import 时即注册各监听器，这里先把它们捕获下来，
// 再在 beforeAll 里动态 import（保证 chrome 桩先于模块级副作用就位）。

type MessageListener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown
type TabUpdatedListener = (tabId: number, changeInfo: { status?: string }) => void
type TabRemovedListener = (tabId: number) => void

const { listeners, actionMock } = vi.hoisted(() => {
  const listeners: {
    message?: MessageListener
    tabUpdated?: TabUpdatedListener
    tabRemoved?: TabRemovedListener
  } = {}
  const actionMock = {
    setBadgeText: vi.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
  }
  return { listeners, actionMock }
})

vi.stubGlobal('chrome', {
  runtime: {
    onMessage: {
      addListener: (fn: MessageListener) => {
        listeners.message = fn
      },
    },
    onInstalled: { addListener: vi.fn() },
    getURL: (p: string) => p,
    openOptionsPage: vi.fn(async () => undefined),
  },
  action: actionMock,
  tabs: {
    onUpdated: {
      addListener: (fn: TabUpdatedListener) => {
        listeners.tabUpdated = fn
      },
    },
    onRemoved: {
      addListener: (fn: TabRemovedListener) => {
        listeners.tabRemoved = fn
      },
    },
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
    create: vi.fn(async () => ({})),
  },
  commands: { onCommand: { addListener: vi.fn() } },
  contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn((_key: string, cb: (r: Record<string, unknown>) => void) => cb({})),
      set: vi.fn((_obj: Record<string, unknown>, cb: () => void) => cb()),
    },
    onChanged: { addListener: vi.fn() },
  },
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
})

beforeAll(async () => {
  await import('../../src/background/index')
})

beforeEach(() => {
  actionMock.setBadgeText.mockClear()
  actionMock.setBadgeBackgroundColor.mockClear()
})

/** 模拟 content 发来 setBadge 消息，并等 handle() 异步链路跑完（sendResponse 被调用） */
async function sendSetBadge(active: boolean, sender: unknown): Promise<void> {
  const sendResponse = vi.fn()
  listeners.message!({ kind: 'setBadge', active }, sender, sendResponse)
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())
}

describe('整页翻译角标（setBadge）', () => {
  it('active=true：设置绿底 ✓ 角标到对应 tab', async () => {
    await sendSetBadge(true, { tab: { id: 42 } })
    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ text: '✓', tabId: 42 })
    expect(actionMock.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#67c23a', tabId: 42 })
  })

  it('active=false：清空该 tab 角标（不动背景色）', async () => {
    await sendSetBadge(false, { tab: { id: 42 } })
    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 42 })
    expect(actionMock.setBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it('sender 无 tab（popup/options 上下文）：忽略，不调用 action API', async () => {
    await sendSetBadge(true, {})
    await sendSetBadge(false, { tab: {} })
    expect(actionMock.setBadgeText).not.toHaveBeenCalled()
    expect(actionMock.setBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it('tabs.onUpdated status=loading：清该 tab 角标（导航兜底）', () => {
    listeners.tabUpdated!(7, { status: 'loading' })
    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 7 })
  })

  it('tabs.onUpdated 非 loading：不清', () => {
    listeners.tabUpdated!(7, { status: 'complete' })
    expect(actionMock.setBadgeText).not.toHaveBeenCalled()
  })

  it('tabs.onRemoved：清该 tab 角标（关标签兜底）', () => {
    listeners.tabRemoved!(9)
    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 9 })
  })
})
