import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { ENGINES } from '../../src/background/engines'
import { resetBatchQueues } from '../../src/background/batch'
import { resetCooldowns } from '../../src/background/translate'
import { compareTranslate, DEFAULT_COMPARE_ENGINES } from '../../src/background/compare'

// ---------- mock：engines 注册表 + 缓存（与 translate.test.ts 同构） ----------

const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, string>() }))

// BYOK 路径的权限断言依赖 chrome.permissions；测试环境默认全部已授予
vi.stubGlobal('chrome', {
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
})

vi.mock('../../src/background/engines', () => {
  const makeEngine = (id: string, kind: 'free' | 'byok', supportsBatch = false) => ({
    id,
    name: `${id}-engine`,
    kind,
    supportsBatch,
    translate: vi.fn(),
    translateBatch: supportsBatch ? vi.fn() : undefined,
  })
  const ENGINES_MOCK: Record<string, ReturnType<typeof makeEngine>> = {
    google: makeEngine('google', 'free'),
    bing: makeEngine('bing', 'free'),
    mymemory: makeEngine('mymemory', 'free'),
    deepl: makeEngine('deepl', 'byok'),
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

vi.mock('../../src/background/cache', () => ({
  cacheKey: (p: { engine: string; text: string }) => `k|${p.engine}|${p.text}`,
  get: vi.fn(async (k: string) => cacheStore.get(k)),
  set: vi.fn(async (k: string, v: string) => {
    cacheStore.set(k, v)
  }),
  clearAll: vi.fn(async () => cacheStore.clear()),
}))

// ---------- 测试工具 ----------

function makeConfig(patch?: { provider?: Config['engine']['provider'] }): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  if (patch?.provider) c.engine.provider = patch.provider
  return c
}

type MockedEngine = (typeof ENGINES)[string]

function installDefaults(e: MockedEngine): void {
  const id = e.id
  vi.mocked(e.translate).mockReset().mockImplementation(async (t: string) => ({
    text: `[${id}]${t}`,
  }))
}

beforeEach(() => {
  vi.useRealTimers()
  cacheStore.clear()
  resetBatchQueues()
  resetCooldowns()
  for (const e of Object.values(ENGINES)) installDefaults(e)
})

// ---------- compareTranslate ----------

describe('compareTranslate', () => {
  it('并行调用全部引擎：慢引擎未返回时其余引擎已启动，结果按 engineIds 顺序排列', async () => {
    const calls: string[] = []
    let resolveGoogle!: (v: { text: string }) => void
    vi.mocked(ENGINES.google.translate).mockImplementation(async () => {
      calls.push('google')
      return await new Promise<{ text: string }>((res) => {
        resolveGoogle = res
      })
    })
    vi.mocked(ENGINES.bing.translate).mockImplementation(async (t: string) => {
      calls.push('bing')
      return { text: `[bing]${t}` }
    })
    vi.mocked(ENGINES.deepl.translate).mockImplementation(async (t: string) => {
      calls.push('deepl')
      return { text: `[deepl]${t}` }
    })

    const p = compareTranslate('hello', 'zh-CN', ['google', 'bing', 'deepl'], makeConfig())
    // google 仍挂起时，bing/deepl 已被调用 → 证明并行而非串行
    await vi.waitFor(() => expect(calls).toEqual(['google', 'bing', 'deepl']))
    resolveGoogle({ text: '[google]hello' })

    const results = await p
    expect(results.map((r) => r.engineId)).toEqual(['google', 'bing', 'deepl'])
    expect(results.map((r) => r.text)).toEqual(['[google]hello', '[bing]hello', '[deepl]hello'])
    expect(results.every((r) => r.error === undefined)).toBe(true)
  })

  it('单引擎失败容错：失败卡片带 error，其余引擎结果不受影响', async () => {
    // 用 BYOK 的 deepl 制造失败：免费引擎失败会被免费链降级兜住（管线既有行为），BYOK 单发直抛
    vi.mocked(ENGINES.deepl.translate).mockRejectedValue(new Error('deepl exploded'))
    const results = await compareTranslate('hi', 'zh-CN', ['google', 'deepl', 'bing'], makeConfig())
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ engineId: 'google', text: '[google]hi' })
    expect(results[1].engineId).toBe('deepl')
    expect(results[1].text).toBeUndefined()
    expect(results[1].error).toContain('deepl exploded')
    expect(results[2]).toMatchObject({ engineId: 'bing', text: '[bing]hi' })
  })

  it('免费引擎整链全灭时该卡片带合并 error，BYOK 引擎不受影响', async () => {
    for (const id of ['google', 'bing', 'mymemory']) {
      vi.mocked(ENGINES[id].translate).mockRejectedValue(new Error(`${id} down`))
    }
    const results = await compareTranslate('hi', 'zh-CN', ['bing', 'deepl'], makeConfig())
    expect(results[0].engineId).toBe('bing')
    expect(results[0].text).toBeUndefined()
    expect(results[0].error).toContain('all free engines failed')
    expect(results[1]).toMatchObject({ engineId: 'deepl', text: '[deepl]hi' })
  })

  it('临时 config 切换 provider：各引擎收到的 ctx.config.engine.provider 为自身 id，原配置不被污染', async () => {
    const config = makeConfig({ provider: 'google' })
    const seen = new Map<string, string>()
    for (const id of ['bing', 'deepl']) {
      vi.mocked(ENGINES[id].translate).mockImplementation(
        async (t: string, _from: string, _to: string, ctx: { config: Config }) => {
          seen.set(id, ctx.config.engine.provider)
          return { text: `[${id}]${t}` }
        },
      )
    }
    await compareTranslate('hello', 'zh-CN', ['bing', 'deepl'], config)
    expect(seen.get('bing')).toBe('bing')
    expect(seen.get('deepl')).toBe('deepl')
    // 原配置未被改写
    expect(config.engine.provider).toBe('google')
  })

  it('每个结果带 elapsedMs 耗时字段（成功与失败均有）', async () => {
    vi.mocked(ENGINES.deepl.translate).mockRejectedValue(new Error('down'))
    const results = await compareTranslate('x', 'zh-CN', ['google', 'deepl'], makeConfig())
    expect(results[1].error).toBeDefined()
    for (const r of results) {
      expect(typeof r.elapsedMs).toBe('number')
      expect(r.elapsedMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('空 engineIds 回退默认引擎集合（google + bing）', async () => {
    const results = await compareTranslate('hello', 'zh-CN', [], makeConfig())
    expect(results.map((r) => r.engineId)).toEqual([...DEFAULT_COMPARE_ENGINES])
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
    expect(ENGINES.bing.translate).toHaveBeenCalledTimes(1)
    expect(ENGINES.deepl.translate).not.toHaveBeenCalled()
  })

  it('未知引擎 id 不抛出：该卡片带 error，其余正常', async () => {
    const results = await compareTranslate('hi', 'zh-CN', ['google', 'nope'], makeConfig())
    expect(results[0].text).toBe('[google]hi')
    expect(results[1].engineId).toBe('nope')
    expect(results[1].error).toContain('unknown engine')
  })

  it('重复 engineId 去重（保序），每个引擎只调一次', async () => {
    const results = await compareTranslate('hi', 'zh-CN', ['google', 'bing', 'google'], makeConfig())
    expect(results.map((r) => r.engineId)).toEqual(['google', 'bing'])
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
  })
})
