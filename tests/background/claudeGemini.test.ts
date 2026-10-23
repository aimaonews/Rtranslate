import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { ENGINES, resolveEngine, setFetchImpl, type EngineContext } from '../../src/background/engines'
import { claudeEngine, createClaudeEngine } from '../../src/background/engines/claude'
import { geminiEngine, createGeminiEngine } from '../../src/background/engines/gemini'
import { PII_PROTECT_NOTE } from '../../src/core/mask'
import { glossaryPromptBlock } from '../../src/core/glossary'

// ---------- 测试基础设施 ----------

interface RecordedCall {
  url: string
  init?: RequestInit
}

let calls: RecordedCall[] = []

function makeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return handler(url, init)
  })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeCtx(patch?: (c: Config) => void): EngineContext {
  const config = structuredClone(DEFAULT_CONFIG)
  patch?.(config)
  return { config }
}

function claudeCtx(patch?: (c: Config) => void): EngineContext {
  return makeCtx((c) => {
    c.engine.keys.claude = 'sk-ant-test'
    patch?.(c)
  })
}

function geminiCtx(patch?: (c: Config) => void): EngineContext {
  return makeCtx((c) => {
    c.engine.keys.gemini = 'gemini-key-test'
    patch?.(c)
  })
}

function claudeResponse(text: string): Response {
  return jsonResponse({ content: [{ type: 'text', text }] })
}

function geminiResponse(...texts: string[]): Response {
  return jsonResponse({
    candidates: [{ content: { role: 'model', parts: texts.map((t) => ({ text: t })) } }],
  })
}

beforeEach(() => {
  calls = []
})

// ---------- claude ----------

describe('claude engine', () => {
  it('单发：URL/headers/body 结构 + 四要素 system prompt', async () => {
    let capturedBody: any
    setFetchImpl(
      makeFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return claudeResponse(' 你好 ')
      })
    )
    const res = await claudeEngine.translate('hello', 'auto', 'zh-CN', claudeCtx())
    expect(res.text).toBe('你好')

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].init?.method).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers['Content-Type']).toBe('application/json')

    expect(capturedBody.model).toBe('claude-haiku-4-5-20251001')
    expect(capturedBody.max_tokens).toBe(2048)
    expect(capturedBody.temperature).toBe(0.1)
    // system 为顶层字段（Anthropic 协议），不在 messages 里
    expect(typeof capturedBody.system).toBe('string')
    expect(capturedBody.system).toContain('professional, authentic translation engine')
    expect(capturedBody.system).toContain('Simplified Chinese')
    expect(capturedBody.system).toContain('Output only the translation')
    expect(capturedBody.system).not.toContain(PII_PROTECT_NOTE)
    expect(capturedBody.messages).toEqual([
      {
        role: 'user',
        content:
          'Translate the following text into Simplified Chinese. Output only the translation, no explanations:\n\nhello',
      },
    ])
  })

  it('自定义 model 生效；文本含 __PII_ 时追加保护句；glossary 非空时注入术语块', async () => {
    let capturedBody: any
    setFetchImpl(
      makeFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return claudeResponse('x')
      })
    )
    const ctx = claudeCtx((c) => {
      c.engine.claude.model = 'claude-opus-4-1'
      c.glossary = [{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }]
    })
    await claudeEngine.translate('mail me at __PII_EMAIL_1__', 'auto', 'en', ctx)
    expect(capturedBody.model).toBe('claude-opus-4-1')
    expect(capturedBody.system).toContain(PII_PROTECT_NOTE)
    expect(capturedBody.system).toContain(
      glossaryPromptBlock([{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }])
    )
  })

  it('响应 data.content[0].text 解析 + stripThinking 剥离思维链', async () => {
    setFetchImpl(makeFetch(() => claudeResponse('<think>let me think\nabout this</think> 译文 ')))
    const res = await claudeEngine.translate('hello', 'auto', 'zh-CN', claudeCtx())
    expect(res.text).toBe('译文')
  })

  it('响应形状异常 / HTTP 错误 / 200 内藏 error 均抛错', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ content: [] })))
    await expect(claudeEngine.translate('a', 'auto', 'en', claudeCtx())).rejects.toThrow(
      /unexpected response shape/
    )
    setFetchImpl(makeFetch(() => jsonResponse({ error: { message: 'invalid api key' } })))
    await expect(claudeEngine.translate('a', 'auto', 'en', claudeCtx())).rejects.toThrow(
      /invalid api key/
    )
    setFetchImpl(makeFetch(() => jsonResponse({ error: { message: 'rate limited' } }, 429)))
    await expect(claudeEngine.translate('a', 'auto', 'en', claudeCtx())).rejects.toThrow(/HTTP 429/)
  })

  it('缺 key 抛引导错误（不发请求）', async () => {
    setFetchImpl(makeFetch(() => claudeResponse('x')))
    await expect(claudeEngine.translate('a', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
    expect(calls).toHaveLength(0)
  })

  it('createClaudeEngine 工厂返回 byok + supportsBatch', () => {
    const e = createClaudeEngine()
    expect(e.id).toBe('claude')
    expect(e.kind).toBe('byok')
    expect(e.requiresKey).toBe(true)
    expect(e.supportsBatch).toBe(true)
  })

  describe('translateBatch 编号 JSON 协议', () => {
    const texts = ['hello', 'world', 'again']

    function batchFetch(content: string) {
      return makeFetch((_url, init) => {
        const body = JSON.parse(init?.body as string)
        expect(body.system).toContain(
          'Output a single JSON object of the form {"translations":[{"id":number,"text":"translation"}]} containing all items, ids must match input.'
        )
        // user 内容与 openaiCompat 批协议相同：编号 JSON 行
        expect(body.messages).toEqual([
          {
            role: 'user',
            content: texts.map((t, i) => JSON.stringify({ id: i + 1, text: t })).join('\n'),
          },
        ])
        return claudeResponse(content)
      })
    }

    it('乱序响应按 id 归位', async () => {
      setFetchImpl(
        batchFetch('{"translations":[{"id":2,"text":"世界"},{"id":1,"text":"你好"},{"id":3,"text":"再一次"}]}')
      )
      const out = await claudeEngine.translateBatch!(texts, 'auto', 'zh-CN', claudeCtx())
      expect(out).toEqual(['你好', '世界', '再一次'])
    })

    it('缺条原文兜底 + 逐条 stripThinking + 围栏容错', async () => {
      setFetchImpl(
        batchFetch(
          '```json\n{"translations":[{"id":1,"text":"<think>嗯</think>你好"},{"id":3,"text":"再一次"}]}\n```'
        )
      )
      const out = await claudeEngine.translateBatch!(texts, 'auto', 'zh-CN', claudeCtx())
      expect(out).toEqual(['你好', 'world', '再一次'])
    })

    it('空批直接返回空数组不发请求', async () => {
      setFetchImpl(makeFetch(() => claudeResponse('x')))
      const out = await claudeEngine.translateBatch!([], 'auto', 'zh-CN', claudeCtx())
      expect(out).toEqual([])
      expect(calls).toHaveLength(0)
    })

    it('缺 key 时批量也抛引导错误', async () => {
      setFetchImpl(makeFetch(() => claudeResponse('x')))
      await expect(claudeEngine.translateBatch!(texts, 'auto', 'zh-CN', makeCtx())).rejects.toThrow(
        /options page/i
      )
    })
  })
})

// ---------- gemini ----------

describe('gemini engine', () => {
  it('单发：URL 含 model 与 key；body 为 system_instruction/contents/generationConfig', async () => {
    let capturedBody: any
    setFetchImpl(
      makeFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return geminiResponse(' 你好 ')
      })
    )
    const res = await geminiEngine.translate('hello', 'auto', 'zh-CN', geminiCtx())
    expect(res.text).toBe('你好')

    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key-test'
    )
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    expect(capturedBody.generationConfig).toEqual({ temperature: 0.1 })
    const sys: string = capturedBody.system_instruction.parts[0].text
    expect(sys).toContain('professional, authentic translation engine')
    expect(sys).toContain('Simplified Chinese')
    expect(sys).toContain('Output only the translation')
    expect(sys).not.toContain(PII_PROTECT_NOTE)
    expect(capturedBody.contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            text: 'Translate the following text into Simplified Chinese. Output only the translation, no explanations:\n\nhello',
          },
        ],
      },
    ])
  })

  it('自定义 model 反映到 URL；多 part 响应拼接', async () => {
    setFetchImpl(makeFetch(() => geminiResponse('你好，', '世界')))
    const ctx = geminiCtx((c) => {
      c.engine.gemini.model = 'gemini-2.5-pro'
    })
    const res = await geminiEngine.translate('hello world', 'auto', 'zh-CN', ctx)
    expect(res.text).toBe('你好，世界')
    expect(calls[0].url).toContain('/models/gemini-2.5-pro:generateContent')
  })

  it('PII 保护句与术语块注入 system_instruction', async () => {
    let capturedBody: any
    setFetchImpl(
      makeFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return geminiResponse('x')
      })
    )
    const ctx = geminiCtx((c) => {
      c.glossary = [{ src: 'LLM', dst: '大语言模型' }]
    })
    await geminiEngine.translate('call __PII_PHONE_1__', 'auto', 'zh-CN', ctx)
    const sys: string = capturedBody.system_instruction.parts[0].text
    expect(sys).toContain(PII_PROTECT_NOTE)
    expect(sys).toContain(glossaryPromptBlock([{ src: 'LLM', dst: '大语言模型' }]))
  })

  it('stripThinking 剥离思维链；剥离后为空则保留原文兜底', async () => {
    setFetchImpl(makeFetch(() => geminiResponse('<thinking>reasoning…</thinking>\n译文')))
    const res = await geminiEngine.translate('hello', 'auto', 'zh-CN', geminiCtx())
    expect(res.text).toBe('译文')

    setFetchImpl(makeFetch(() => geminiResponse('<think>only thinking</think>')))
    const fallback = await geminiEngine.translate('hello', 'auto', 'zh-CN', geminiCtx())
    expect(fallback.text).toBe('<think>only thinking</think>')
  })

  it('响应形状异常 / HTTP 错误 / 200 内藏 error 均抛错', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ candidates: [] })))
    await expect(geminiEngine.translate('a', 'auto', 'en', geminiCtx())).rejects.toThrow(
      /unexpected response shape/
    )
    setFetchImpl(makeFetch(() => jsonResponse({ error: { message: 'API key not valid' } })))
    await expect(geminiEngine.translate('a', 'auto', 'en', geminiCtx())).rejects.toThrow(
      /API key not valid/
    )
    setFetchImpl(makeFetch(() => jsonResponse({ error: { message: 'quota' } }, 429)))
    await expect(geminiEngine.translate('a', 'auto', 'en', geminiCtx())).rejects.toThrow(/HTTP 429/)
  })

  it('缺 key 抛引导错误（不发请求）', async () => {
    setFetchImpl(makeFetch(() => geminiResponse('x')))
    await expect(geminiEngine.translate('a', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
    expect(calls).toHaveLength(0)
  })

  it('createGeminiEngine 工厂返回 byok + supportsBatch', () => {
    const e = createGeminiEngine()
    expect(e.id).toBe('gemini')
    expect(e.kind).toBe('byok')
    expect(e.requiresKey).toBe(true)
    expect(e.supportsBatch).toBe(true)
  })

  describe('translateBatch 编号 JSON 协议', () => {
    const texts = ['hello', 'world', 'again']

    function batchFetch(content: string) {
      return makeFetch((_url, init) => {
        const body = JSON.parse(init?.body as string)
        expect(body.system_instruction.parts[0].text).toContain(
          'Output a single JSON object of the form {"translations":[{"id":number,"text":"translation"}]} containing all items, ids must match input.'
        )
        expect(body.contents).toEqual([
          {
            role: 'user',
            parts: [{ text: texts.map((t, i) => JSON.stringify({ id: i + 1, text: t })).join('\n') }],
          },
        ])
        expect(body.generationConfig).toEqual({ temperature: 0.1 })
        return geminiResponse(content)
      })
    }

    it('乱序响应按 id 归位', async () => {
      setFetchImpl(
        batchFetch('{"translations":[{"id":3,"text":"再一次"},{"id":1,"text":"你好"},{"id":2,"text":"世界"}]}')
      )
      const out = await geminiEngine.translateBatch!(texts, 'auto', 'zh-CN', geminiCtx())
      expect(out).toEqual(['你好', '世界', '再一次'])
    })

    it('缺条原文兜底 + 幻觉越界 id 忽略', async () => {
      setFetchImpl(
        batchFetch('{"translations":[{"id":1,"text":"你好"},{"id":99,"text":"??"},{"id":3,"text":"再一次"}]}')
      )
      const out = await geminiEngine.translateBatch!(texts, 'auto', 'zh-CN', geminiCtx())
      expect(out).toEqual(['你好', 'world', '再一次'])
    })

    it('非 JSON 响应抛错（上层回退单发）', async () => {
      setFetchImpl(batchFetch('no json at all'))
      await expect(geminiEngine.translateBatch!(texts, 'auto', 'zh-CN', geminiCtx())).rejects.toThrow(
        /not valid JSON/
      )
    })

    it('空批直接返回空数组不发请求', async () => {
      setFetchImpl(makeFetch(() => geminiResponse('x')))
      const out = await geminiEngine.translateBatch!([], 'auto', 'zh-CN', geminiCtx())
      expect(out).toEqual([])
      expect(calls).toHaveLength(0)
    })
  })
})

// ---------- 注册表 / resolveEngine ----------

describe('claude/gemini 注册与路由', () => {
  it('注册进 ENGINES，kind 为 byok 且支持批协议', () => {
    expect(ENGINES.claude).toBeDefined()
    expect(ENGINES.gemini).toBeDefined()
    expect(ENGINES.claude.kind).toBe('byok')
    expect(ENGINES.gemini.kind).toBe('byok')
    expect(ENGINES.claude.supportsBatch).toBe(true)
    expect(ENGINES.gemini.supportsBatch).toBe(true)
  })

  it('缺 key 时 resolveEngine 抛引导错误；有 key 返回实例', () => {
    expect(() => resolveEngine('claude', makeCtx())).toThrow(/options page/i)
    expect(() => resolveEngine('gemini', makeCtx())).toThrow(/options page/i)
    const ctx = makeCtx((c) => {
      c.engine.keys.claude = 'k1'
      c.engine.keys.gemini = 'k2'
    })
    expect(resolveEngine('claude', ctx)).toBe(ENGINES.claude)
    expect(resolveEngine('gemini', ctx)).toBe(ENGINES.gemini)
  })
})
