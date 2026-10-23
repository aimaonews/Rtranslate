/**
 * aimaoCustom.test.ts — AI猫内置引擎 + 多实例自定义引擎（custom:<id>）核心。
 *
 * 覆盖：
 * - aimaoEngine：固定端点 / keys.aimao / engine.aimao.model 的请求体来源
 * - syncCustomEngines：custom:<id> 条目的增 / 删 / 改 / 多实例 / 自定义 headers / 脏数据容错
 * - resolveEngine：custom:<id> 动态解析与未同步兜底报错
 * - endpointUrlOf：aimao / custom:<id> / 既有分支
 * - isAiProvider：AI 名单 + custom: 前缀判定
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config, type CustomEngine } from '../../src/shared/config'
import {
  CUSTOM_ENGINE_PREFIX,
  ENGINES,
  resolveEngine,
  syncCustomEngines,
  type EngineContext,
} from '../../src/background/engines'
import { AIMAO_ENDPOINT, aimaoEngine } from '../../src/background/engines/aimao'
import { setFetchImpl } from '../../src/background/engines/fetch'
import { endpointUrlOf, isAiProvider, resolveAiEndpoint } from '../../src/background/translate'

// ---------- 测试工具 ----------

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

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeConfig(patch?: (c: Config) => void): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  patch?.(c)
  return c
}

function makeCtx(patch?: (c: Config) => void): EngineContext {
  return { config: makeConfig(patch) }
}

function makeEntry(id: string, patch?: Partial<CustomEngine>): CustomEngine {
  return {
    id,
    name: `引擎 ${id}`,
    endpoint: `https://api.${id}.example.com/v1`,
    apiKey: `sk-${id}`,
    model: `model-${id}`,
    headersJson: '',
    ...patch,
  }
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  setFetchImpl(null)
  // 清理动态条目，避免用例间通过全局注册表串扰
  syncCustomEngines(makeConfig())
})

// ---------- aimao 引擎 ----------

describe('aimaoEngine', () => {
  it('元数据：id/name/kind/supportsBatch，并登记在 ENGINES', () => {
    expect(aimaoEngine.id).toBe('aimao')
    expect(aimaoEngine.name).toBe('AI猫')
    expect(aimaoEngine.kind).toBe('byok')
    expect(aimaoEngine.supportsBatch).toBe(true)
    expect(ENGINES.aimao).toBe(aimaoEngine)
  })

  it('请求体：固定 endpoint，key 读 keys.aimao，model 读 engine.aimao.model', async () => {
    installFetch(() => chatResponse(' 你好 '))
    const ctx = makeCtx((c) => {
      c.engine.keys.aimao = 'ak-mao'
      c.engine.aimao.model = 'aimao-pro'
    })
    const res = await aimaoEngine.translate('hello', 'auto', 'zh-CN', ctx)
    expect(res.text).toBe('你好')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.aimao.today/v1/chat/completions')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ak-mao')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(calls[0].init?.body)) as { model: string; temperature: number }
    expect(body.model).toBe('aimao-pro')
    expect(body.temperature).toBe(0.1)
  })

  it('endpoint 常量唯一来源：AIMAO_ENDPOINT', () => {
    expect(AIMAO_ENDPOINT).toBe('https://api.aimao.today/v1')
  })

  it('缺 key：引擎调用与 resolveEngine 都抛设置页引导错误', async () => {
    installFetch(() => chatResponse('x'))
    await expect(aimaoEngine.translate('a', 'auto', 'en', makeCtx())).rejects.toThrow(/options page/i)
    expect(() => resolveEngine('aimao', makeCtx())).toThrow(/options page/i)
    const withKey = makeCtx((c) => {
      c.engine.keys.aimao = 'ak'
    })
    expect(resolveEngine('aimao', withKey)).toBe(aimaoEngine)
  })
})

// ---------- syncCustomEngines ----------

describe('syncCustomEngines', () => {
  it('增：按 entry 创建 custom:<id> 实例，请求带 entry 的 endpoint/key/model/自定义头', async () => {
    installFetch(() => chatResponse('译'))
    const config = makeConfig((c) => {
      c.engine.customEngines = [
        makeEntry('e1', { name: '我的引擎', headersJson: '{"X-Team":"blue","X-Num":7}' }),
      ]
    })
    syncCustomEngines(config)

    const engine = ENGINES[`${CUSTOM_ENGINE_PREFIX}e1`]
    expect(engine).toBeDefined()
    expect(engine.id).toBe('custom:e1')
    expect(engine.name).toBe('我的引擎')
    expect(engine.kind).toBe('byok')
    expect(engine.supportsBatch).toBe(true)

    const res = await engine.translate('hello', 'auto', 'zh-CN', { config })
    expect(res.text).toBe('译')
    expect(calls[0].url).toBe('https://api.e1.example.com/v1/chat/completions')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-e1')
    expect(headers['X-Team']).toBe('blue')
    // 非字符串值被丢弃
    expect(headers['X-Num']).toBeUndefined()
    expect(JSON.parse(String(calls[0].init?.body)).model).toBe('model-e1')
  })

  it('删：重建后旧 custom:* 条目被移除，内置引擎不受影响', () => {
    syncCustomEngines(makeConfig((c) => {
      c.engine.customEngines = [makeEntry('e1'), makeEntry('e2')]
    }))
    expect(ENGINES['custom:e1']).toBeDefined()
    expect(ENGINES['custom:e2']).toBeDefined()

    syncCustomEngines(makeConfig()) // 空 customEngines
    expect(ENGINES['custom:e1']).toBeUndefined()
    expect(ENGINES['custom:e2']).toBeUndefined()
    // 内置条目（含旧版单发 custom 引擎）原样保留
    for (const id of ['google', 'bing', 'mymemory', 'deepl', 'openai', 'deepseek', 'claude', 'gemini', 'aimao', 'libretranslate', 'custom']) {
      expect(ENGINES[id]).toBeDefined()
    }
  })

  it('改：同一 id 重新同步后端点/名称/模型生效（无陈旧闭包）', async () => {
    installFetch(() => chatResponse('x'))
    syncCustomEngines(makeConfig((c) => {
      c.engine.customEngines = [makeEntry('e1', { name: '旧名' })]
    }))
    expect(ENGINES['custom:e1'].name).toBe('旧名')

    const v2 = makeConfig((c) => {
      c.engine.customEngines = [
        makeEntry('e1', {
          name: '新名',
          endpoint: 'https://v2.example.com/v1',
          apiKey: 'sk-v2',
          model: 'm-v2',
        }),
      ]
    })
    syncCustomEngines(v2)
    const engine = ENGINES['custom:e1']
    expect(engine.name).toBe('新名')
    await engine.translate('hi', 'auto', 'en', { config: v2 })
    expect(calls[0].url).toBe('https://v2.example.com/v1/chat/completions')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-v2')
    expect(JSON.parse(String(calls[0].init?.body)).model).toBe('m-v2')
  })

  it('多实例共存，互不干扰', async () => {
    installFetch(() => chatResponse('ok'))
    const config = makeConfig((c) => {
      c.engine.customEngines = [makeEntry('a'), makeEntry('b')]
    })
    syncCustomEngines(config)
    await ENGINES['custom:a'].translate('x', 'auto', 'en', { config })
    await ENGINES['custom:b'].translate('x', 'auto', 'en', { config })
    expect(calls[0].url).toBe('https://api.a.example.com/v1/chat/completions')
    expect(calls[1].url).toBe('https://api.b.example.com/v1/chat/completions')
  })

  it('headersJson 非法 / 非对象时容错为无自定义头，不拖垮同步', async () => {
    installFetch(() => chatResponse('ok'))
    const config = makeConfig((c) => {
      c.engine.customEngines = [makeEntry('bad', { headersJson: '{oops' }), makeEntry('arr', { headersJson: '[1]' })]
    })
    expect(() => syncCustomEngines(config)).not.toThrow()
    await ENGINES['custom:bad'].translate('x', 'auto', 'en', { config })
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-bad')
    expect(Object.keys(headers)).toEqual(['Authorization', 'Content-Type'])
  })

  it('entry.id 为空串时跳过该条目', () => {
    syncCustomEngines(makeConfig((c) => {
      c.engine.customEngines = [makeEntry('')]
    }))
    expect(ENGINES['custom:']).toBeUndefined()
  })
})

// ---------- resolveEngine 解析 custom:<id> ----------

describe('resolveEngine custom:<id>', () => {
  it('已同步的实例正常返回', () => {
    const config = makeConfig((c) => {
      c.engine.customEngines = [makeEntry('e1')]
    })
    syncCustomEngines(config)
    const engine = resolveEngine('custom:e1', { config })
    expect(engine).toBe(ENGINES['custom:e1'])
    expect(engine.id).toBe('custom:e1')
  })

  it('未同步（无此配置）时保持 unknown engine 兜底报错', () => {
    expect(() => resolveEngine('custom:ghost', makeCtx())).toThrow(/unknown engine "custom:ghost"/)
  })

  it('同步后删除条目，再次解析回到兜底报错', () => {
    syncCustomEngines(makeConfig((c) => {
      c.engine.customEngines = [makeEntry('e1')]
    }))
    expect(() => resolveEngine('custom:e1', makeCtx())).not.toThrow()
    syncCustomEngines(makeConfig())
    expect(() => resolveEngine('custom:e1', makeCtx())).toThrow(/unknown engine/)
  })
})

// ---------- endpointUrlOf ----------

describe('endpointUrlOf', () => {
  it('openai / deepseek：config endpoint 优先，缺省回退官方端点', () => {
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'openai' }))).toBe('https://api.openai.com/v1')
    expect(endpointUrlOf(makeConfig((c) => {
      c.engine.provider = 'openai'
      c.engine.openai.endpoint = 'https://proxy.example.com/v1'
    }))).toBe('https://proxy.example.com/v1')
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'deepseek' }))).toBe('https://api.deepseek.com/v1')
  })

  it('claude / gemini / libretranslate / custom（旧版单发）', () => {
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'claude' }))).toBe('https://api.anthropic.com')
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'gemini' }))).toBe('https://generativelanguage.googleapis.com')
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'libretranslate' }))).toBe('https://libretranslate.com')
    expect(endpointUrlOf(makeConfig((c) => {
      c.engine.provider = 'libretranslate'
      c.engine.keys.libreUrl = 'http://localhost:5000'
    }))).toBe('http://localhost:5000')
    expect(endpointUrlOf(makeConfig((c) => {
      c.engine.provider = 'custom'
      c.engine.custom.url = 'https://my.api/translate'
    }))).toBe('https://my.api/translate')
  })

  it('aimao：固定端点', () => {
    expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = 'aimao' }))).toBe('https://api.aimao.today/v1')
  })

  it('custom:<id>：返回 entry.endpoint；条目缺失或端点为空返回 null', () => {
    const withEntry = makeConfig((c) => {
      c.engine.provider = 'custom:e1'
      c.engine.customEngines = [makeEntry('e1', { endpoint: 'https://e1.example.com/v1' })]
    })
    expect(endpointUrlOf(withEntry)).toBe('https://e1.example.com/v1')

    const missing = makeConfig((c) => {
      c.engine.provider = 'custom:ghost'
    })
    expect(endpointUrlOf(missing)).toBeNull()

    const blank = makeConfig((c) => {
      c.engine.provider = 'custom:e1'
      c.engine.customEngines = [makeEntry('e1', { endpoint: '  ' })]
    })
    expect(endpointUrlOf(blank)).toBeNull()
  })

  it('免费引擎返回 null（无需端点授权）', () => {
    for (const p of ['google', 'bing', 'mymemory', 'deepl']) {
      expect(endpointUrlOf(makeConfig((c) => { c.engine.provider = p }))).toBeNull()
    }
  })
})

// ---------- isAiProvider ----------

describe('isAiProvider', () => {
  it('内置 AI 名单：openai/deepseek/claude/gemini/aimao', () => {
    for (const p of ['openai', 'deepseek', 'claude', 'gemini', 'aimao']) {
      expect(isAiProvider(p)).toBe(true)
    }
  })

  it('custom: 前缀的动态实例视为 AI 引擎', () => {
    expect(isAiProvider('custom:e1')).toBe(true)
    expect(isAiProvider('custom:')).toBe(true)
  })

  it('机器引擎与旧版 custom 不算 AI 引擎', () => {
    for (const p of ['google', 'bing', 'mymemory', 'deepl', 'libretranslate', 'custom', '']) {
      expect(isAiProvider(p)).toBe(false)
    }
  })
})

// ---------- resolveAiEndpoint（aiAssist/aiChat/aiWrite 共用的端点解析） ----------

describe('resolveAiEndpoint', () => {
  it('aimao：固定 base + engine.aimao.model + keys.aimao', () => {
    const config = makeConfig((c) => {
      c.engine.provider = 'aimao'
      c.engine.keys.aimao = 'ak-1'
      c.engine.aimao.model = 'aimao-lite'
    })
    expect(resolveAiEndpoint(config)).toEqual({
      base: 'https://api.aimao.today/v1',
      model: 'aimao-lite',
      apiKey: 'ak-1',
    })
  })

  it('custom:<id>：取 entry 的 endpoint（去尾斜杠）/model/apiKey', () => {
    const config = makeConfig((c) => {
      c.engine.provider = 'custom:e1'
      c.engine.customEngines = [makeEntry('e1', { endpoint: 'https://e1.example.com/v1/' })]
    })
    expect(resolveAiEndpoint(config)).toEqual({
      base: 'https://e1.example.com/v1',
      model: 'model-e1',
      apiKey: 'sk-e1',
    })
  })

  it('缺 key / 条目缺失 / 非 AI provider 抛配置引导错误', () => {
    expect(() => resolveAiEndpoint(makeConfig((c) => { c.engine.provider = 'aimao' }))).toThrow(
      '请先在设置页配置 AI 引擎',
    )
    expect(() => resolveAiEndpoint(makeConfig((c) => { c.engine.provider = 'custom:ghost' }))).toThrow(
      '请先在设置页配置 AI 引擎',
    )
    expect(() => resolveAiEndpoint(makeConfig((c) => { c.engine.provider = 'google' }))).toThrow(
      '请先在设置页配置 AI 引擎',
    )
  })
})
