import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import type { EngineContext } from '../../src/background/engines'
import { ENGINES, FREE_CHAIN, resolveEngine, setFetchImpl } from '../../src/background/engines'
import { googleEngine, parseGoogleSingle } from '../../src/background/engines/google'
import { bingEngine, resetBingTokenCache, toBingLang } from '../../src/background/engines/bing'
import { MYMEMORY_MAX_CHARS, mymemoryEngine } from '../../src/background/engines/mymemory'
import { deeplEngine, toDeepLLang } from '../../src/background/engines/deepl'
import { libreEngine } from '../../src/background/engines/libre'
import {
  createOpenAICompatEngine,
  deepseekEngine,
  openaiEngine,
  parseBatchResponse,
} from '../../src/background/engines/openaiCompat'
import { customEngine, extractFirstString, renderBodyTemplate } from '../../src/background/engines/custom'
import { normalizeLangCode } from '../../src/core/langs'
import { PII_PROTECT_NOTE } from '../../src/core/mask'
import { glossaryPromptBlock } from '../../src/core/glossary'

// ---------- 测试基础设施 ----------

interface RecordedCall {
  url: string
  init?: RequestInit
}

let calls: RecordedCall[] = []

function makeFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const result = handler(url, init)
    if (result instanceof Promise) return result
    return result
  })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

function makeCtx(patch?: (c: Config) => void): EngineContext {
  const config = structuredClone(DEFAULT_CONFIG)
  patch?.(config)
  return { config }
}

/** 带 OpenAI 兼容 key 的 ctx（openaiEngine/deepseekEngine 需要）。 */
function llmCtx(patch?: (c: Config) => void): EngineContext {
  return makeCtx((c) => {
    c.engine.keys.openai = 'sk-test'
    patch?.(c)
  })
}

beforeEach(() => {
  calls = []
  resetBingTokenCache()
})

// ---------- google ----------

describe('google engine', () => {
  it('短文本走 GET，拼接嵌套数组并返回检测语言', async () => {
    setFetchImpl(
      makeFetch(() =>
        jsonResponse([
          [
            ['你好，', 'Hello,', null, null, 1],
            ['世界', 'world', null, null, 1],
          ],
          null,
          'en',
          null,
          null,
          null,
          null,
          [['world']],
        ])
      )
    )
    const res = await googleEngine.translate('Hello, world', 'auto', 'zh-CN', makeCtx())
    expect(res.text).toBe('你好，世界')
    expect(res.detectedLang).toBe('en')
    expect(calls[0].url).toContain('client=gtx')
    expect(calls[0].url).toContain('sl=auto')
    expect(calls[0].url).toContain('tl=zh-CN')
    expect(calls[0].url).toContain('dt=t')
    // URLSearchParams 把空格编码为 '+'，用 searchParams 解码后比对原文
    expect(new URL(calls[0].url).searchParams.get('q')).toBe('Hello, world')
    expect(calls[0].init?.method).toBeUndefined()
  })

  it('>700 字符改走 POST form', async () => {
    setFetchImpl(makeFetch(() => jsonResponse([[['译', 'x']], null, 'en'])))
    const long = 'a'.repeat(701)
    await googleEngine.translate(long, 'en', 'zh-CN', makeCtx())
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    })
    expect(calls[0].init?.body as string).toBe(`q=${encodeURIComponent(long)}`)
    expect(calls[0].url).not.toContain('q=')
  })

  it('含换行等控制字符也走 POST', async () => {
    setFetchImpl(makeFetch(() => jsonResponse([[['译', 'x']], null, 'en'])))
    await googleEngine.translate('line1\nline2', 'en', 'zh-CN', makeCtx())
    expect(calls[0].init?.method).toBe('POST')
  })

  it('parseGoogleSingle 对坏形状抛错', () => {
    expect(() => parseGoogleSingle({})).toThrow()
    expect(() => parseGoogleSingle([null, null, 'en'])).toThrow()
    expect(parseGoogleSingle([[['a'], null, 5]],)).toEqual({ text: 'a', detectedLang: undefined })
  })
})

// ---------- bing ----------

function fakeJwt(expSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: expSeconds })}.sig`
}

const bingTranslateResponse = [
  {
    detectedLanguage: { language: 'en', score: 1 },
    translations: [{ text: '你好', to: 'zh-Hans' }],
  },
]

describe('bing engine', () => {
  it('先取 JWT 再翻译；两次调用复用缓存', async () => {
    const authCalls = { n: 0 }
    setFetchImpl(
      makeFetch((url) => {
        if (url.startsWith('https://edge.microsoft.com/translate/auth')) {
          authCalls.n++
          return textResponse(fakeJwt(Math.floor(Date.now() / 1000) + 3600))
        }
        return jsonResponse(bingTranslateResponse)
      })
    )
    const ctx = makeCtx()
    const r1 = await bingEngine.translate('hello', 'auto', 'zh-CN', ctx)
    const r2 = await bingEngine.translate('hello', 'auto', 'zh-CN', ctx)
    expect(r1).toEqual({ text: '你好', detectedLang: 'en' })
    expect(r2.text).toBe('你好')
    expect(authCalls.n).toBe(1)
    // 翻译请求的形状
    const t = calls.find((c) => c.url.startsWith('https://api.cognitive.microsofttranslator.com'))!
    expect(t.url).toContain('api-version=3.0')
    expect(t.url).toContain('to=zh-Hans')
    expect(t.url).toContain('textType=plain')
    expect(t.url).not.toContain('from=')
    expect(t.init?.method).toBe('POST')
    expect((t.init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer .+\.sig$/)
    expect(JSON.parse(t.init?.body as string)).toEqual([{ Text: 'hello' }])
  })

  it('exp 在 5 分钟之内则提前重取 token', async () => {
    let authCalls = 0
    setFetchImpl(
      makeFetch((url) => {
        if (url.startsWith('https://edge.microsoft.com/translate/auth')) {
          authCalls++
          // exp 在未来 4 分钟（<5 分钟 skew）→ 立即视为过期
          return textResponse(fakeJwt(Math.floor(Date.now() / 1000) + 240))
        }
        return jsonResponse(bingTranslateResponse)
      })
    )
    const ctx = makeCtx()
    await bingEngine.translate('a', 'auto', 'en', ctx)
    await bingEngine.translate('b', 'auto', 'en', ctx)
    expect(authCalls).toBe(2)
  })

  it('指定 from 时带上 from 参数并做语言映射', async () => {
    setFetchImpl(
      makeFetch((url) =>
        url.startsWith('https://edge.microsoft.com') ? textResponse(fakeJwt(0)) : jsonResponse(bingTranslateResponse)
      )
    )
    await bingEngine.translate('hello', 'zh-TW', 'zh-CN', makeCtx())
    const t = calls.find((c) => c.url.startsWith('https://api.cognitive.microsofttranslator.com'))!
    expect(t.url).toContain('from=zh-Hant')
  })

  it('HTTP 200 里藏业务错误（非数组）时抛错', async () => {
    setFetchImpl(
      makeFetch((url) =>
        url.startsWith('https://edge.microsoft.com')
          ? textResponse(fakeJwt(0))
          : jsonResponse({ statusCode: 400, message: 'too long' })
      )
    )
    await expect(bingEngine.translate('x'.repeat(99999), 'auto', 'en', makeCtx())).rejects.toThrow(
      /business error/
    )
  })

  it('toBingLang 映射', () => {
    expect(toBingLang('zh-CN')).toBe('zh-Hans')
    expect(toBingLang('zh')).toBe('zh-Hans')
    expect(toBingLang('zh-SG')).toBe('zh-Hans')
    expect(toBingLang('zh-TW')).toBe('zh-Hant')
    expect(toBingLang('zh-HK')).toBe('zh-Hant')
    expect(toBingLang('zh-Hant')).toBe('zh-Hant')
    expect(toBingLang('en')).toBe('en')
    expect(toBingLang('en-US')).toBe('en')
    expect(toBingLang('ja')).toBe('ja')
  })
})

// ---------- mymemory ----------

describe('mymemory engine', () => {
  it('正常往返', async () => {
    setFetchImpl(
      makeFetch(() => jsonResponse({ responseStatus: 200, responseData: { translatedText: '你好' } }))
    )
    const res = await mymemoryEngine.translate('hello', 'en', 'zh-CN', makeCtx())
    expect(res.text).toBe('你好')
    const url = calls[0].url
    expect(url).toContain('api.mymemory.translated.net/get')
    expect(url).toContain(`q=hello`)
    expect(url).toContain(`langpair=${encodeURIComponent('en|zh-CN')}`)
  })

  it("'auto' 源语言兜底为 en", async () => {
    setFetchImpl(
      makeFetch(() => jsonResponse({ responseStatus: 200, responseData: { translatedText: 'x' } }))
    )
    await mymemoryEngine.translate('hello', 'auto', 'it', makeCtx())
    expect(calls[0].url).toContain(`langpair=${encodeURIComponent('en|it')}`)
  })

  it('responseStatus !== 200 抛错（藏在 HTTP 200 里）', async () => {
    setFetchImpl(
      makeFetch(() =>
        jsonResponse({ responseStatus: 429, responseMessage: 'RATE_LIMITED', responseData: null })
      )
    )
    await expect(mymemoryEngine.translate('hello', 'en', 'zh-CN', makeCtx())).rejects.toThrow(
      /RATE_LIMITED/
    )
  })

  it('>500 字符截断', async () => {
    setFetchImpl(
      makeFetch(() => jsonResponse({ responseStatus: 200, responseData: { translatedText: 'x' } }))
    )
    const long = 'x'.repeat(MYMEMORY_MAX_CHARS + 50)
    await mymemoryEngine.translate(long, 'en', 'zh-CN', makeCtx())
    const q = new URL(calls[0].url).searchParams.get('q')!
    expect(q.length).toBe(MYMEMORY_MAX_CHARS)
  })
})

// ---------- deepl ----------

describe('deepl engine', () => {
  it('请求形状与语言映射', async () => {
    setFetchImpl(
      makeFetch(() =>
        jsonResponse({ translations: [{ text: '你好', detected_source_language: 'EN' }] })
      )
    )
    const ctx = makeCtx((c) => {
      c.engine.keys.deepl = 'key-123'
    })
    const res = await deeplEngine.translate('hello', 'auto', 'zh-TW', ctx)
    expect(res).toEqual({ text: '你好', detectedLang: 'EN' })
    expect(calls[0].url).toBe('https://api-free.deepl.com/v2/translate')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key key-123')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ text: ['hello'], target_lang: 'ZH' })
  })

  it('指定 from 时带 source_lang', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ translations: [{ text: 'hi' }] })))
    const ctx = makeCtx((c) => {
      c.engine.keys.deepl = 'k'
    })
    await deeplEngine.translate('bonjour', 'fr', 'en', ctx)
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      text: ['bonjour'],
      target_lang: 'EN-US',
      source_lang: 'FR',
    })
  })

  it('缺 key 抛明确错误', async () => {
    await expect(deeplEngine.translate('hello', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
  })

  it('toDeepLLang 映射', () => {
    expect(toDeepLLang('zh-CN')).toBe('ZH')
    expect(toDeepLLang('zh-TW')).toBe('ZH')
    expect(toDeepLLang('zh')).toBe('ZH')
    expect(toDeepLLang('en')).toBe('EN-US')
    expect(toDeepLLang('en-GB')).toBe('EN-US')
    expect(toDeepLLang('fr')).toBe('FR')
    expect(toDeepLLang('pt-BR')).toBe('PT')
  })
})

// ---------- libre ----------

describe('libre engine', () => {
  it('默认公共实例 + 去地区语言码', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ translatedText: '你好' })))
    const res = await libreEngine.translate('hello', 'auto', 'zh-CN', makeCtx())
    expect(res.text).toBe('你好')
    expect(calls[0].url).toBe('https://libretranslate.com/translate')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      q: 'hello',
      source: 'auto',
      target: 'zh',
      format: 'text',
    })
  })

  it('自托管 URL 去尾斜杠', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ translatedText: 'x' })))
    const ctx = makeCtx((c) => {
      c.engine.keys.libreUrl = 'http://localhost:5000/'
    })
    await libreEngine.translate('a', 'en', 'de', ctx)
    expect(calls[0].url).toBe('http://localhost:5000/translate')
  })
})

// ---------- openaiCompat ----------

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { role: 'assistant', content } }] })
}

describe('openaiCompat factory', () => {
  it('单发：四要素 system prompt + temperature 0.1', async () => {
    let capturedSystem = ''
    setFetchImpl(
      makeFetch((_url, init) => {
        const body = JSON.parse(init?.body as string)
        capturedSystem = body.messages[0].content
        expect(body.messages[0].role).toBe('system')
        // 单发 user 走激活专家（默认「通用」）模板渲染
        expect(body.messages[1]).toEqual({
          role: 'user',
          content:
            'Translate the following text into Simplified Chinese. Output only the translation, no explanations:\n\nhello',
        })
        expect(body.temperature).toBe(0.1)
        expect(body.model).toBe('gpt-4o-mini')
        return chatResponse(' 你好 ')
      })
    )
    const res = await openaiEngine.translate('hello', 'auto', 'zh-CN', llmCtx())
    expect(res.text).toBe('你好')
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(capturedSystem).toContain('professional, authentic translation engine')
    expect(capturedSystem).toContain('Simplified Chinese')
    expect(capturedSystem).toContain('Output only the translation')
    expect(capturedSystem).not.toContain(PII_PROTECT_NOTE)
    expect(capturedSystem).not.toContain('__PII_')
  })

  it('文本含 __PII_ 时追加保护句；glossary 非空时注入 prompt 块', async () => {
    let capturedSystem = ''
    setFetchImpl(
      makeFetch((_url, init) => {
        capturedSystem = JSON.parse(init?.body as string).messages[0].content
        return chatResponse('x')
      })
    )
    await openaiEngine.translate('mail me at __PII_EMAIL_1__', 'auto', 'en', llmCtx((c) => {
      c.glossary = [{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }]
    }))
    expect(capturedSystem).toContain(PII_PROTECT_NOTE)
    expect(capturedSystem).toContain(glossaryPromptBlock([{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }]))
  })

  it('缺 key 抛引导错误', async () => {
    setFetchImpl(makeFetch(() => chatResponse('x')))
    await expect(openaiEngine.translate('a', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
  })

  it('deepseek 读 config.engine.deepseek 且 key 复用 keys.openai', async () => {
    setFetchImpl(makeFetch(() => chatResponse(' 你好 ')))
    const ctx = makeCtx((c) => {
      c.engine.keys.openai = 'sk-shared'
      c.engine.deepseek.endpoint = 'https://api.deepseek.com/v1'
      c.engine.deepseek.model = 'deepseek-chat'
    })
    const res = await deepseekEngine.translate('hello', 'auto', 'zh-CN', ctx)
    expect(res.text).toBe('你好')
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-shared')
    expect(JSON.parse(calls[0].init?.body as string).model).toBe('deepseek-chat')
  })

  it('endpoint 尾斜杠归一化', async () => {
    setFetchImpl(makeFetch(() => chatResponse('ok')))
    const engine = createOpenAICompatEngine({
      id: 't1',
      name: 'T1',
      getEndpoint: () => 'https://example.com/v1/',
      getApiKey: () => 'k',
      getModel: () => 'm',
    })
    await engine.translate('a', 'auto', 'en', makeCtx())
    expect(calls[0].url).toBe('https://example.com/v1/chat/completions')
  })

  describe('translateBatch 编号 JSON 协议', () => {    function batchFetch(content: string) {
      return makeFetch((_url, init) => {
        const body = JSON.parse(init?.body as string)
        const sys: string = body.messages[0].content
        const user: string = body.messages[1].content
        expect(sys).toContain(
          'Output a single JSON object of the form {"translations":[{"id":number,"text":"translation"}]} containing all items, ids must match input.'
        )
        expect(user).toBe(
          texts.map((t, i) => JSON.stringify({ id: i + 1, text: t })).join('\n')
        )
        return chatResponse(content)
      })
    }
    const texts = ['hello', 'world', 'again']

    it('user 内容编号编码 + 乱序响应对齐', async () => {
      setFetchImpl(
        batchFetch('{"translations":[{"id":2,"text":"世界"},{"id":1,"text":"你好"},{"id":3,"text":"再一次"}]}')
      )
      const out = await openaiEngine.translateBatch!(texts, 'auto', 'zh-CN', llmCtx())
      expect(out).toEqual(['你好', '世界', '再一次'])
    })

    it('缺条用原文兜底，幻觉越界 id 忽略', async () => {
      setFetchImpl(
        batchFetch('{"translations":[{"id":1,"text":"你好"},{"id":99,"text":"??"},{"id":3,"text":"再一次"}]}')
      )
      const out = await openaiEngine.translateBatch!(texts, 'auto', 'zh-CN', llmCtx())
      expect(out).toEqual(['你好', 'world', '再一次'])
    })

    it('markdown 围栏/前后缀文本容错抽取', async () => {
      setFetchImpl(
        batchFetch('Sure! Here you go:\n```json\n{"translations":[{"id":1,"text":"你好"}]}\n```')
      )
      const out = await openaiEngine.translateBatch!(texts, 'auto', 'zh-CN', llmCtx())
      expect(out).toEqual(['你好', 'world', 'again'])
    })

    it('非 JSON 响应抛错（上层回退单发）', async () => {
      setFetchImpl(batchFetch('no json at all'))
      await expect(openaiEngine.translateBatch!(texts, 'auto', 'zh-CN', llmCtx())).rejects.toThrow(
        /not valid JSON/
      )
    })

    it('空批直接返回空数组不发请求', async () => {
      setFetchImpl(makeFetch(() => chatResponse('x')))
      const out = await openaiEngine.translateBatch!([], 'auto', 'zh-CN', makeCtx())
      expect(out).toEqual([])
      expect(calls).toHaveLength(0)
    })
  })

  describe('parseBatchResponse', () => {
    it('缺 translations 数组抛错', () => {
      expect(() => parseBatchResponse('{"foo":1}', ['a'])).toThrow(/translations/)
    })
  })
})

// ---------- custom ----------

describe('custom engine', () => {
  it('模板渲染 + 自定义 headers', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ text: '你好' })))
    const ctx = makeCtx((c) => {
      c.engine.custom.url = 'https://my.api/translate'
      c.engine.custom.bodyJson = '{"text":"{{text}}","from":"{{from}}","to":"{{to}}"}'
      c.engine.keys.customHeadersJson = '{"X-Token":"abc"}'
    })
    const res = await customEngine.translate('he said "hi"\nbye', 'en', 'zh-CN', ctx)
    expect(res.text).toBe('你好')
    expect(calls[0].url).toBe('https://my.api/translate')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['X-Token']).toBe('abc')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(calls[0].init?.body as string)
    expect(body).toEqual({ text: 'he said "hi"\nbye', from: 'en', to: 'zh-CN' })
  })

  it('三种响应形态：{text} / {translation} / {data:{text}}', async () => {
    setFetchImpl(makeFetch(() => jsonResponse({ translation: '译' })))
    const ctx = makeCtx((c) => {
      c.engine.custom.url = 'https://x/'
    })
    expect((await customEngine.translate('a', 'auto', 'en', ctx)).text).toBe('译')
    setFetchImpl(makeFetch(() => jsonResponse({ data: { text: '深' } })))
    expect((await customEngine.translate('a', 'auto', 'en', ctx)).text).toBe('深')
    setFetchImpl(makeFetch(() => jsonResponse({ result: { output: '嵌' } })))
    expect((await customEngine.translate('a', 'auto', 'en', ctx)).text).toBe('嵌')
  })

  it('缺 url / headers JSON 非法时抛错', async () => {
    await expect(customEngine.translate('a', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
    setFetchImpl(makeFetch(() => jsonResponse({ text: 'x' })))
    const ctx = makeCtx((c) => {
      c.engine.custom.url = 'https://x/'
      c.engine.keys.customHeadersJson = '{oops'
    })
    await expect(customEngine.translate('a', 'auto', 'en', ctx)).rejects.toThrow(/customHeadersJson/)
  })

  it('renderBodyTemplate 转义原文中的引号', () => {
    const out = renderBodyTemplate('{"q":"{{text}}"}', { text: 'say "hi"', from: 'en', to: 'zh' })
    expect(JSON.parse(out)).toEqual({ q: 'say "hi"' })
  })

  it('extractFirstString 深度优先', () => {
    expect(extractFirstString({ a: 1, b: { text: 'hit' } })).toBe('hit')
    expect(extractFirstString([{ x: 'y' }])).toBe('y')
    expect(extractFirstString({ n: null })).toBeNull()
  })
})

// ---------- 注册表 / resolveEngine ----------

describe('registry', () => {
  it('注册全部引擎 + 免费链顺序', () => {
    for (const id of ['google', 'bing', 'mymemory', 'deepl', 'openai', 'deepseek', 'libretranslate', 'custom']) {
      expect(ENGINES[id]).toBeDefined()
    }
    expect(FREE_CHAIN).toEqual(['google', 'bing', 'mymemory'])
    expect(ENGINES.google.kind).toBe('free')
    expect(ENGINES.openai.supportsBatch).toBe(true)
  })

  it('BYOK 缺 key/缺 url 时 resolveEngine 抛引导错误', () => {
    expect(() => resolveEngine('deepl', makeCtx())).toThrow(/options page/i)
    expect(() => resolveEngine('openai', makeCtx())).toThrow(/options page/i)
    expect(() => resolveEngine('deepseek', makeCtx())).toThrow(/options page/i)
    expect(() => resolveEngine('custom', makeCtx())).toThrow(/options page/i)
    const ctx = makeCtx((c) => {
      c.engine.keys.deepl = 'k'
      c.engine.keys.openai = 'k'
      c.engine.custom.url = 'https://x/'
    })
    expect(resolveEngine('deepl', ctx)).toBe(ENGINES.deepl)
    expect(resolveEngine('openai', ctx)).toBe(ENGINES.openai)
    expect(resolveEngine('deepseek', ctx)).toBe(ENGINES.deepseek)
    expect(resolveEngine('custom', ctx)).toBe(ENGINES.custom)
    expect(resolveEngine('google', makeCtx())).toBe(ENGINES.google)
  })

  it('未知引擎抛错', () => {
    expect(() => resolveEngine('nope', makeCtx())).toThrow(/unknown engine/)
  })
})

// ---------- normalizeLangCode 集成 ----------

describe('normalizeLangCode', () => {
  it('大小写/下划线/默认地区归一化', () => {
    expect(normalizeLangCode('EN')).toBe('en')
    expect(normalizeLangCode('en_us')).toBe('en')
    expect(normalizeLangCode('zh')).toBe('zh-CN')
    expect(normalizeLangCode('zh-TW')).toBe('zh-TW')
    expect(normalizeLangCode('zh_hant')).toBe('zh-TW')
    expect(normalizeLangCode('zh-Hans')).toBe('zh-CN')
    expect(normalizeLangCode('auto')).toBe('auto')
    expect(normalizeLangCode('  fr  ')).toBe('fr')
  })
})
