import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import type { AiWriteAction } from '../../src/shared/protocol'
import { setFetchImpl } from '../../src/background/engines/fetch'
import {
  AI_WRITE_PROVIDER_ERROR,
  TEXT_DELIMITER,
  aiWrite,
  buildWritingMessages,
} from '../../src/background/aiWrite'

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

function installFetch(handler: (url: string, init?: RequestInit) => Response): void {
  setFetchImpl(
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return handler(url, init)
    }),
  )
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ALL_ACTIONS: AiWriteAction[] = ['polish', 'continue', 'summarize', 'reply', 'translate']

beforeEach(() => {
  calls = []
})

afterEach(() => {
  setFetchImpl(null)
})

// ---------- prompt 模板要素 ----------

describe('buildWritingMessages prompt 模板', () => {
  const config = makeConfig()

  it.each(ALL_ACTIONS)('%s：含动作指令 / 语言约束首尾双放 / 文本分隔符 / 防注入声明', (action) => {
    const msgs = buildWritingMessages(action, 'Hello draft text', {}, config)
    expect(msgs).toHaveLength(2)
    const [system, user] = msgs
    expect(system.role).toBe('system')
    expect(user.role).toBe('user')

    // 语言约束首尾双放（防漂移）：首行与尾行均为同一句语言要求
    const langReq =
      'Required output language: Simplified Chinese. Write the entire output in this language only.'
    const lines = system.content.split('\n')
    expect(lines[0]).toBe(langReq)
    expect(lines[lines.length - 1]).toBe(langReq)

    // 防注入：system 声明引用数据，user 用 ---TEXT--- 包裹
    expect(system.content).toContain(TEXT_DELIMITER)
    expect(system.content).toContain('not instructions')
    expect(user.content).toBe(`${TEXT_DELIMITER}\nHello draft text\n${TEXT_DELIMITER}`)

    // 只输出成品
    expect(system.content).toContain('Output only')
  })

  it('polish：润色指令（保持原意、不加新信息）', () => {
    const [system] = buildWritingMessages('polish', 't', {}, config)
    expect(system.content).toContain('Rewrite the draft')
    expect(system.content).toContain('Preserve the original meaning')
    expect(system.content).toContain('do not add new information')
  })

  it('continue：续写指令（自然续写、不重复原文）', () => {
    const [system] = buildWritingMessages('continue', 't', {}, config)
    expect(system.content).toContain('Continue the draft naturally')
    expect(system.content).toContain('do not repeat the original draft')
  })

  it('summarize：总结指令（3-5 条要点 bullet）', () => {
    const [system] = buildWritingMessages('summarize', 't', {}, config)
    expect(system.content).toContain('Summarize')
    expect(system.content).toContain('3-5 key points')
    expect(system.content).toContain('bullet list')
  })

  it('reply：回复指令（得体回复、不捏造承诺）', () => {
    const [system] = buildWritingMessages('reply', 't', {}, config)
    expect(system.content).toContain('Draft an appropriate reply')
    expect(system.content).toContain('Do not fabricate commitments')
  })

  it('translate：翻译指令（保真、用 opts.targetLang 的语言全名）', () => {
    const [system] = buildWritingMessages('translate', 't', { targetLang: 'en' }, config)
    expect(system.content).toContain('Faithfully translate')
    expect(system.content).toContain('Required output language: English.')
  })

  it('translate 缺省 targetLang 时回落到 config.general.targetLang', () => {
    const [system] = buildWritingMessages('translate', 't', {}, config)
    expect(system.content).toContain('Required output language: Simplified Chinese.')
  })

  it('语气 / 篇幅参数注入 system prompt', () => {
    const [system] = buildWritingMessages(
      'reply',
      't',
      { tone: 'formal', length: 'shorter' },
      config,
    )
    expect(system.content).toContain('Tone: formal and polite.')
    expect(system.content).toContain('shorter and more concise')
  })

  it('默认语气 / 篇幅不附加偏好行', () => {
    const [system] = buildWritingMessages('polish', 't', { tone: 'default', length: 'default' }, config)
    expect(system.content).not.toContain('Tone:')
    expect(system.content).not.toContain('Length:')
  })

  it('未知语气值按自定义语气短文本透传', () => {
    const [system] = buildWritingMessages('reply', 't', { tone: 'empathetic' }, config)
    expect(system.content).toContain('Tone: empathetic.')
  })
})

// ---------- 配置校验 ----------

describe('aiWrite 配置校验', () => {
  it('未配置 API Key 抛「请先在设置页配置 AI 引擎」', async () => {
    const config = makeConfig((c) => {
      c.engine.keys.openai = ''
    })
    await expect(aiWrite('polish', 'text', {}, config)).rejects.toThrow(AI_WRITE_PROVIDER_ERROR)
  })

  it('provider 不是 openai/deepseek 时抛同样错误', async () => {
    const config = makeConfig((c) => {
      c.engine.provider = 'google'
    })
    await expect(aiWrite('polish', 'text', {}, config)).rejects.toThrow(AI_WRITE_PROVIDER_ERROR)
  })
})

// ---------- 请求体验证（mock fetch） ----------

describe('aiWrite 请求', () => {
  it('POST chat/completions：URL / 鉴权头 / 请求体 / 返回 trim 后文本', async () => {
    installFetch(() => jsonResponse({ choices: [{ message: { content: '  polished text  ' } }] }))
    const config = makeConfig()
    const out = await aiWrite('polish', 'draft', { tone: 'casual', length: 'longer' }, config)
    expect(out).toBe('polished text')

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-key')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(String(init?.body)) as {
      model: string
      temperature: number
      stream: boolean
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(false)
    expect(typeof body.temperature).toBe('number')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Tone: casual and relaxed.')
    expect(body.messages[1].content).toBe(`${TEXT_DELIMITER}\ndraft\n${TEXT_DELIMITER}`)
  })

  it('deepseek provider 使用 deepseek 的 endpoint 与 model', async () => {
    installFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const config = makeConfig((c) => {
      c.engine.provider = 'deepseek'
    })
    await aiWrite('translate', 'draft', { targetLang: 'en' }, config)
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String(calls[0].init?.body)) as { model: string }
    expect(body.model).toBe('deepseek-chat')
  })

  it('自定义 endpoint：去掉末尾斜杠后拼接路径', async () => {
    installFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const config = makeConfig((c) => {
      c.engine.openai.endpoint = 'https://proxy.example.com/v1/'
    })
    await aiWrite('summarize', 'draft', {}, config)
    expect(calls[0].url).toBe('https://proxy.example.com/v1/chat/completions')
  })

  it('HTTP 非 2xx 抛 aiWrite: HTTP <status>', async () => {
    installFetch(() => jsonResponse({}, 500))
    await expect(aiWrite('polish', 't', {}, makeConfig())).rejects.toThrow('aiWrite: HTTP 500')
  })

  it('响应体含 error.message 时抛该信息', async () => {
    installFetch(() => jsonResponse({ error: { message: 'insufficient quota' } }))
    await expect(aiWrite('polish', 't', {}, makeConfig())).rejects.toThrow(
      'aiWrite: insufficient quota',
    )
  })

  it('响应形状异常时抛 unexpected response shape', async () => {
    installFetch(() => jsonResponse({ choices: [] }))
    await expect(aiWrite('polish', 't', {}, makeConfig())).rejects.toThrow(
      'aiWrite: unexpected response shape',
    )
  })
})
