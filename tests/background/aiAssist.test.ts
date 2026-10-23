import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { setFetchImpl } from '../../src/background/engines/fetch'
import { aiAssist, aiChat, buildAssistUserMessage } from '../../src/background/translate'
import { addWord, getWords } from '../../src/shared/store'

// ---------- mock：engines 注册表（translate.ts 模块级导入，本套件不触达引擎） ----------

vi.mock('../../src/background/engines', () => {
  const makeEngine = (id: string, kind: 'free' | 'byok') => ({
    id,
    name: id,
    kind,
    supportsBatch: false,
    translate: vi.fn(),
  })
  const ENGINES_MOCK: Record<string, ReturnType<typeof makeEngine>> = {
    google: makeEngine('google', 'free'),
    bing: makeEngine('bing', 'free'),
    mymemory: makeEngine('mymemory', 'free'),
    deepl: makeEngine('deepl', 'byok'),
    openai: makeEngine('openai', 'byok'),
    deepseek: makeEngine('deepseek', 'byok'),
  }
  return {
    ENGINES: ENGINES_MOCK,
    FREE_CHAIN: ['google', 'bing', 'mymemory'],
    resolveEngine: (id: string) => {
      const e = ENGINES_MOCK[id]
      if (!e) throw new Error(`resolveEngine: unknown engine "${id}"`)
      return e
    },
  }
})

// chrome stub：permissions（端点授权断言）+ storage.local（生词本存储，内存版）
const { storageData } = vi.hoisted(() => ({ storageData: new Map<string, unknown>() }))

vi.stubGlobal('chrome', {
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
  storage: {
    local: {
      get: (key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: storageData.get(key) })
      },
      set: (obj: Record<string, unknown>, cb: () => void) => {
        for (const [k, v] of Object.entries(obj)) storageData.set(k, v)
        cb()
      },
    },
  },
})

// ---------- 测试工具 ----------

function makeConfig(patch?: (c: Config) => void): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  c.engine.provider = 'openai'
  c.engine.keys.openai = 'sk-test-key'
  patch?.(c)
  return c
}

interface RecordedCall {
  url: string
  init?: RequestInit
}

let calls: RecordedCall[] = []

function lastRequestBody(): {
  model: string
  stream: boolean
  messages: Array<{ role: string; content: string }>
} {
  const init = calls[calls.length - 1]?.init
  expect(init).toBeDefined()
  return JSON.parse(String(init!.body))
}

function installFetch(handler?: (url: string, init?: RequestInit) => Response): void {
  setFetchImpl(
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (handler) return handler(url, init)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '  mock 回答  ' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }),
  )
}

beforeEach(() => {
  calls = []
  storageData.clear()
})

afterEach(() => {
  setFetchImpl(null)
})

// ---------- aiAssist 上下文注入 ----------

describe('aiAssist 上下文注入', () => {
  it('无 context：user 消息保持原文（向后兼容）', async () => {
    installFetch()
    await aiAssist('meaning', 'run', 'zh-CN', makeConfig())
    const body = lastRequestBody()
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'run' })
  })

  it('带 context：user 消息含 <context> 包裹的上下文与"仅供理解不要翻译"声明', async () => {
    installFetch()
    const ctx = 'The boy could run fast when he was young.'
    await aiAssist('meaning', 'run', 'zh-CN', makeConfig(), ctx)
    const user = lastRequestBody().messages[1].content
    expect(user).toContain('<context>')
    expect(user).toContain('</context>')
    expect(user).toContain(ctx)
    expect(user).toContain('不要翻译')
    // 上下文块在前，待分析原文在后
    expect(user.indexOf('<context>')).toBeLessThan(user.lastIndexOf('run'))
    expect(user.endsWith('run')).toBe(true)
  })

  it('context 为空白字符串时按无上下文处理', async () => {
    installFetch()
    await aiAssist('grammar', 'a sentence', 'zh-CN', makeConfig(), '   ')
    expect(lastRequestBody().messages[1].content).toBe('a sentence')
  })

  it('buildAssistUserMessage：纯函数验证上下文块结构', () => {
    const msg = buildAssistUserMessage('serendipity', 'a moment of pure serendipity')
    expect(msg).toBe(
      'The following context comes from the page around the selected text. ' +
        'It is provided for comprehension only — do not translate it (以下上下文仅供理解，不要翻译):\n' +
        '<context>\na moment of pure serendipity\n</context>\n\nserendipity',
    )
    expect(buildAssistUserMessage('word')).toBe('word')
  })

  it('非流式请求且走 openai 兼容端点', async () => {
    installFetch()
    await aiAssist('usage', 'run', 'zh-CN', makeConfig())
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(lastRequestBody().stream).toBe(false)
  })
})

// ---------- aiChat 多轮追问 ----------

describe('aiChat 多轮追问', () => {
  const history = [
    { role: 'user' as const, content: '选中内容：run\n页面上下文：The boy could run fast.\n初始问题：请解析。' },
    { role: 'assistant' as const, content: '首轮回答：run 释义…' },
    { role: 'user' as const, content: '和 walk 有什么区别？' },
  ]

  it('完整对话历史按序发送：system 在前，user/assistant 交替保持原序', async () => {
    installFetch()
    const reply = await aiChat(history, makeConfig())
    expect(reply).toBe('mock 回答') // 响应 trim
    const body = lastRequestBody()
    expect(body.stream).toBe(false)
    expect(body.messages).toHaveLength(4)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages.slice(1)).toEqual(history)
  })

  it('复用 deepseek 配置端点与模型', async () => {
    installFetch()
    const config = makeConfig((c) => {
      c.engine.provider = 'deepseek'
      c.engine.deepseek.endpoint = 'https://api.deepseek.com/v1/'
      c.engine.deepseek.model = 'deepseek-chat'
    })
    await aiChat(history, config)
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(lastRequestBody().model).toBe('deepseek-chat')
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key')
  })

  it('空消息数组直接抛错，不发请求', async () => {
    installFetch()
    await expect(aiChat([], makeConfig())).rejects.toThrow('aiChat: empty messages')
    expect(calls).toHaveLength(0)
  })

  it('provider 非 openai/deepseek 抛配置引导错误', async () => {
    installFetch()
    const config = makeConfig((c) => {
      c.engine.provider = 'google'
    })
    await expect(aiChat(history, config)).rejects.toThrow('请先在设置页配置 AI 引擎')
    expect(calls).toHaveLength(0)
  })

  it('未配置 API key 抛配置引导错误', async () => {
    installFetch()
    const config = makeConfig((c) => {
      c.engine.keys.openai = '   '
    })
    await expect(aiChat(history, config)).rejects.toThrow('请先在设置页配置 AI 引擎')
    expect(calls).toHaveLength(0)
  })

  it('HTTP 错误与业务 error 字段均抛错', async () => {
    installFetch(() => new Response('boom', { status: 429 }))
    await expect(aiChat(history, makeConfig())).rejects.toThrow('aiChat: HTTP 429')

    calls = []
    installFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    await expect(aiChat(history, makeConfig())).rejects.toThrow('aiChat: quota exceeded')
  })
})

// ---------- addWord 生词来源 ----------

describe('addWord 生词来源 URL', () => {
  it('新词存储 pageUrl 与 pageTitle', async () => {
    const item = await addWord({
      word: 'serendipity',
      context: 'a moment of pure serendipity',
      pageUrl: 'https://example.com/article',
      pageTitle: 'Example Article',
    })
    expect(item.pageUrl).toBe('https://example.com/article')
    expect(item.pageTitle).toBe('Example Article')
    const words = await getWords()
    expect(words).toHaveLength(1)
    expect(words[0].pageUrl).toBe('https://example.com/article')
    expect(words[0].pageTitle).toBe('Example Article')
  })

  it('不传来源时字段为 undefined（旧数据兼容）', async () => {
    const item = await addWord({ word: 'hello' })
    expect(item.pageUrl).toBeUndefined()
    expect(item.pageTitle).toBeUndefined()
  })

  it('重复收藏：seenCount 递增，缺失的来源字段回填，已有来源不被覆盖', async () => {
    await addWord({ word: 'Run' })
    const again = await addWord({
      word: 'run',
      pageUrl: 'https://b.com/page',
      pageTitle: 'B Page',
    })
    expect(again.seenCount).toBe(2)
    expect(again.pageUrl).toBe('https://b.com/page')
    expect(again.pageTitle).toBe('B Page')

    const third = await addWord({
      word: 'RUN',
      pageUrl: 'https://c.com/other',
      pageTitle: 'C Other',
    })
    expect(third.seenCount).toBe(3)
    // 已有来源不覆盖
    expect(third.pageUrl).toBe('https://b.com/page')
    expect(third.pageTitle).toBe('B Page')

    const words = await getWords()
    expect(words).toHaveLength(1)
  })
})
