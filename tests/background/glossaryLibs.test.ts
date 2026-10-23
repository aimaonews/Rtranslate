/**
 * background/glossaryLibs 单测：
 * - parseGlossaryCsv：引号/逗号/转义/表头/tgt_lng 过滤边界
 * - resolveEffectiveGlossary：用户术语 + 内置库 + 自定义库的合并、去重、排序、开关语义
 * - loadBuiltinLibrary：fetch + 内存缓存
 * - extractTermsWithAI / parseExtractedTerms：JSON 容错解析、AI 未配置抛错
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { setFetchImpl } from '../../src/background/engines/fetch'
import {
  parseGlossaryCsv,
  parseExtractedTerms,
  loadBuiltinLibrary,
  listBuiltinLibraries,
  resolveEffectiveGlossary,
  extractTermsWithAI,
  resetGlossaryLibCaches,
} from '../../src/background/glossaryLibs'

// chrome.runtime.getURL stub（options/background 环境均有；测试环境补一个恒等映射）
vi.stubGlobal('chrome', {
  runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
})

function makeConfig(mutate?: (c: Config) => void): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  mutate?.(c)
  return c
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

const INDEX_JSON = {
  source: 'https://github.com/immersive-translate/terms',
  libraries: [
    { id: 'programming', name: 'Programming', zhName: '编程', file: 'programming_zh-CN.csv' },
    { id: 'web3', name: 'Web3', zhName: 'Web3', file: 'web3_zh-CN.csv' },
  ],
}

beforeEach(() => {
  resetGlossaryLibCaches()
})

afterEach(() => {
  setFetchImpl(null)
})

// ── parseGlossaryCsv ─────────────────────────────────────────────────────────

describe('parseGlossaryCsv', () => {
  it('解析标准三列并跳过表头', () => {
    const csv = 'source,target,tgt_lng\nBlockchain,区块链,zh-CN\nToken,代币,zh-CN\n'
    expect(parseGlossaryCsv(csv)).toEqual([
      { src: 'Blockchain', dst: '区块链' },
      { src: 'Token', dst: '代币' },
    ])
  })

  it('只保留 tgt_lng 为 zh-CN 的行', () => {
    const csv = [
      'source,target,tgt_lng',
      'Blockchain,区块链,zh-CN',
      'Blockchain,區塊鏈,zh-TW',
      'Token,代币,zh-CN',
    ].join('\n')
    expect(parseGlossaryCsv(csv)).toEqual([
      { src: 'Blockchain', dst: '区块链' },
      { src: 'Token', dst: '代币' },
    ])
  })

  it('引号包裹字段可含逗号', () => {
    const csv = 'source,target,tgt_lng\n"Hello, World","你好，世界",zh-CN\n'
    expect(parseGlossaryCsv(csv)).toEqual([{ src: 'Hello, World', dst: '你好，世界' }])
  })

  it('双引号转义（"" → "）', () => {
    const csv = 'source,target,tgt_lng\n"say ""hi""","说""嗨""",zh-CN\n'
    expect(parseGlossaryCsv(csv)).toEqual([{ src: 'say "hi"', dst: '说"嗨"' }])
  })

  it('引号字段内可含换行', () => {
    const csv = 'source,target,tgt_lng\n"line1\nline2","第一行\n第二行",zh-CN\n'
    expect(parseGlossaryCsv(csv)).toEqual([{ src: 'line1\nline2', dst: '第一行\n第二行' }])
  })

  it('跳过空 src/dst 与缺列的行；容忍 CRLF', () => {
    const csv =
      'source,target,tgt_lng\r\nA,甲,zh-CN\r\n,缺源,zh-CN\r\n缺目标,,zh-CN\r\nonlyone\r\nB,乙,zh-CN\r\n'
    expect(parseGlossaryCsv(csv)).toEqual([
      { src: 'A', dst: '甲' },
      { src: 'B', dst: '乙' },
    ])
  })

  it('空输入与纯表头返回空数组', () => {
    expect(parseGlossaryCsv('')).toEqual([])
    expect(parseGlossaryCsv('source,target,tgt_lng\n')).toEqual([])
  })
})

// ── listBuiltinLibraries / loadBuiltinLibrary ────────────────────────────────

describe('内置库加载', () => {
  it('加载索引并按 id 加载 CSV，第二次命中内存缓存', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('index.json')) return jsonResponse(INDEX_JSON)
      if (url.endsWith('programming_zh-CN.csv'))
        return textResponse('source,target,tgt_lng\nCache,缓存,zh-CN\nDebug,调试,zh-CN\n')
      throw new Error(`unexpected url ${url}`)
    })
    setFetchImpl(fetchMock)

    const libs = await listBuiltinLibraries()
    expect(libs).toHaveLength(2)

    const terms = await loadBuiltinLibrary('programming')
    expect(terms).toEqual([
      { src: 'Cache', dst: '缓存' },
      { src: 'Debug', dst: '调试' },
    ])

    // 第二次加载不再发请求
    const again = await loadBuiltinLibrary('programming')
    expect(again).toBe(terms)
    expect(fetchMock).toHaveBeenCalledTimes(2) // index + csv 各一次
  })

  it('未知 id 抛错', async () => {
    setFetchImpl(vi.fn(async () => jsonResponse(INDEX_JSON)))
    await expect(loadBuiltinLibrary('nope')).rejects.toThrow('未知内置术语库')
  })
})

// ── resolveEffectiveGlossary ─────────────────────────────────────────────────

describe('resolveEffectiveGlossary', () => {
  function installBuiltinFetch(): void {
    setFetchImpl(
      vi.fn(async (url: string) => {
        if (url.endsWith('index.json')) return jsonResponse(INDEX_JSON)
        if (url.endsWith('programming_zh-CN.csv'))
          return textResponse('source,target,tgt_lng\nCache,缓存,zh-CN\nDebug,调试,zh-CN\n')
        if (url.endsWith('web3_zh-CN.csv'))
          return textResponse('source,target,tgt_lng\nBlockchain,区块链,zh-CN\nCache,链上缓存,zh-CN\n')
        throw new Error(`unexpected url ${url}`)
      }),
    )
  }

  it('无库时仅返回用户术语', async () => {
    const config = makeConfig((c) => {
      c.glossary = [{ src: 'foo', dst: '福' }]
    })
    const terms = await resolveEffectiveGlossary(config)
    expect(terms).toEqual([{ src: 'foo', dst: '福' }])
  })

  it('合并用户术语 + 启用内置库 + 自定义库，用户术语覆盖同名', async () => {
    installBuiltinFetch()
    const config = makeConfig((c) => {
      c.glossary = [{ src: 'Cache', dst: '用户缓存' }]
      c.glossaryLibs.enabled = { programming: true }
      c.glossaryLibs.custom = [
        { id: 'custom-1', name: '我的', terms: [{ src: 'MyTerm', dst: '我的术语' }] },
      ]
    })
    const terms = await resolveEffectiveGlossary(config)
    // 同名 Cache（大小写不敏感）用户优先
    const cache = terms.filter((t) => t.src.toLowerCase() === 'cache')
    expect(cache).toEqual([{ src: 'Cache', dst: '用户缓存' }])
    // 三个来源都在
    expect(terms).toContainEqual({ src: 'Debug', dst: '调试' })
    expect(terms).toContainEqual({ src: 'MyTerm', dst: '我的术语' })
  })

  it('结果按 src 长度降序', async () => {
    installBuiltinFetch()
    const config = makeConfig((c) => {
      c.glossary = [
        { src: 'ab', dst: 'x' },
        { src: 'abcdef', dst: 'y' },
        { src: 'abcd', dst: 'z' },
      ]
    })
    const terms = await resolveEffectiveGlossary(config)
    const lens = terms.map((t) => t.src.length)
    expect(lens).toEqual([...lens].sort((a, b) => b - a))
    expect(terms[0].src).toBe('abcdef')
  })

  it('未启用的内置库不加载；自定义库 enabled[id]===false 时排除', async () => {
    installBuiltinFetch()
    const config = makeConfig((c) => {
      c.glossaryLibs.enabled = { web3: false, 'custom-1': false }
      c.glossaryLibs.custom = [
        { id: 'custom-1', name: '关', terms: [{ src: 'Off', dst: '关' }] },
        { id: 'custom-2', name: '开', terms: [{ src: 'On', dst: '开' }] },
      ]
    })
    const terms = await resolveEffectiveGlossary(config)
    expect(terms).toEqual([{ src: 'On', dst: '开' }])
  })

  it('内置库加载失败不阻断其余来源', async () => {
    setFetchImpl(
      vi.fn(async (url: string) => {
        if (url.endsWith('index.json')) return jsonResponse(INDEX_JSON)
        return textResponse('boom', 500)
      }),
    )
    const config = makeConfig((c) => {
      c.glossary = [{ src: 'foo', dst: '福' }]
      c.glossaryLibs.enabled = { programming: true, web3: true }
    })
    const terms = await resolveEffectiveGlossary(config)
    expect(terms).toEqual([{ src: 'foo', dst: '福' }])
  })

  it('两个内置库同名术语先声明者优先（按 enabled 键序）', async () => {
    installBuiltinFetch()
    const config = makeConfig((c) => {
      // programming 的 Cache=缓存 应先于 web3 的 Cache=链上缓存
      c.glossaryLibs.enabled = { programming: true, web3: true }
    })
    const terms = await resolveEffectiveGlossary(config)
    const cache = terms.filter((t) => t.src.toLowerCase() === 'cache')
    expect(cache).toHaveLength(1)
    expect(cache[0].dst).toBe('缓存')
    expect(terms).toContainEqual({ src: 'Blockchain', dst: '区块链' })
  })
})

// ── parseExtractedTerms ──────────────────────────────────────────────────────

describe('parseExtractedTerms', () => {
  it('解析纯 JSON 数组', () => {
    const content = '[{"src":"API","dst":"接口"},{"src":"SDK","dst":"开发工具包"}]'
    expect(parseExtractedTerms(content)).toEqual([
      { src: 'API', dst: '接口' },
      { src: 'SDK', dst: '开发工具包' },
    ])
  })

  it('容错：抽取 markdown 围栏/前后散文中的首个 JSON 数组', () => {
    const content = '好的，提取结果如下：\n```json\n[{"src":"LLM","dst":"大语言模型"}]\n```\n以上。'
    expect(parseExtractedTerms(content)).toEqual([{ src: 'LLM', dst: '大语言模型' }])
  })

  it('过滤缺字段/空串/重复项（大小写不敏感）', () => {
    const content = JSON.stringify([
      { src: 'API', dst: '接口' },
      { src: 'api', dst: '重复' },
      { src: '', dst: '空' },
      { src: 'NoDst' },
      { dst: 'NoSrc' },
      'not-an-object',
      42,
      { src: '  Padded  ', dst: '  填充  ' },
    ])
    expect(parseExtractedTerms(content)).toEqual([
      { src: 'API', dst: '接口' },
      { src: 'Padded', dst: '填充' },
    ])
  })

  it('无 JSON 数组或非法 JSON 返回空数组', () => {
    expect(parseExtractedTerms('没有任何数组')).toEqual([])
    expect(parseExtractedTerms('[{"src": 未闭合')).toEqual([])
    expect(parseExtractedTerms('{"src":"a","dst":"b"}')).toEqual([])
  })
})

// ── extractTermsWithAI ───────────────────────────────────────────────────────

describe('extractTermsWithAI', () => {
  it('未配置 AI key 抛配置引导错误', async () => {
    const config = makeConfig((c) => {
      c.engine.provider = 'openai'
      c.engine.keys.openai = ''
    })
    await expect(extractTermsWithAI('text', 'zh-CN', config)).rejects.toThrow('请先在设置页配置 AI 引擎')
  })

  it('非 openai/deepseek provider 抛配置引导错误', async () => {
    const config = makeConfig((c) => {
      c.engine.provider = 'google'
    })
    await expect(extractTermsWithAI('text', 'zh-CN', config)).rejects.toThrow('请先在设置页配置 AI 引擎')
  })

  it('正常返回解析后的术语（openai 兼容端点）', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          { message: { content: '结果：[{"src":"Blockchain","dst":"区块链"}]' } },
        ],
      }),
    )
    setFetchImpl(fetchMock)
    const config = makeConfig((c) => {
      c.engine.provider = 'openai'
      c.engine.keys.openai = 'sk-test'
      c.engine.openai.endpoint = 'https://api.example.com/v1'
      c.engine.openai.model = 'test-model'
    })
    const terms = await extractTermsWithAI('some text about blockchain', 'zh-CN', config)
    expect(terms).toEqual([{ src: 'Blockchain', dst: '区块链' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] }
    expect(body.model).toBe('test-model')
    expect(body.messages).toHaveLength(2)
  })

  it('HTTP 错误与 API error 字段均抛错', async () => {
    setFetchImpl(vi.fn(async () => textResponse('server error', 500)))
    const config = makeConfig((c) => {
      c.engine.provider = 'deepseek'
      c.engine.keys.openai = 'sk-test'
    })
    await expect(extractTermsWithAI('t', 'zh-CN', config)).rejects.toThrow('HTTP 500')

    setFetchImpl(vi.fn(async () => jsonResponse({ error: { message: 'bad key' } })))
    await expect(extractTermsWithAI('t', 'zh-CN', config)).rejects.toThrow('bad key')
  })
})
