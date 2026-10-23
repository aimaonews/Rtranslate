import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { ENGINES } from '../../src/background/engines'
import { resetBatchQueues } from '../../src/background/batch'
import { detectLang, translate, translateTexts, resetCooldowns } from '../../src/background/translate'

// ---------- mock：engines 注册表 + 缓存 ----------

const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, string>() }))

// 权限断言依赖 chrome.permissions；测试环境默认全部已授予
vi.stubGlobal('chrome', {
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
})

vi.mock('../../src/background/engines', () => {
  const makeEngine = (id: string, kind: 'free' | 'byok', supportsBatch = false) => ({
    id,
    name: id,
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
    openai: makeEngine('openai', 'byok', true),
    deepseek: makeEngine('deepseek', 'byok', true),
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

interface MakeConfigPatch {
  provider?: Config['engine']['provider']
  glossary?: Config['glossary']
  mask?: boolean
  batch?: boolean
}

function makeConfig(patch?: MakeConfigPatch): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  if (patch?.provider) c.engine.provider = patch.provider
  if (patch?.glossary) c.glossary = patch.glossary
  if (patch?.mask !== undefined) c.mask.enabled = patch.mask
  if (patch?.batch !== undefined) c.batch.enabled = patch.batch
  return c
}

type MockedEngine = (typeof ENGINES)[string]

function installDefaults(e: MockedEngine): void {
  const id = e.id
  vi.mocked(e.translate).mockReset().mockImplementation(async (t: string) => ({
    text: `[${id}]${t}`,
  }))
  if (e.translateBatch) {
    vi.mocked(e.translateBatch)
      .mockReset()
      .mockImplementation(async (texts: string[]) => texts.map((t) => `[${id}:batch]${t}`))
  }
}

beforeEach(() => {
  vi.useRealTimers()
  cacheStore.clear()
  resetBatchQueues()
  resetCooldowns()
  for (const e of Object.values(ENGINES)) installDefaults(e)
})

// ---------- 管线顺序 ----------

describe('translate 管线顺序', () => {
  it('mask → glossary → 引擎 → 逆序还原（glossary 先还原、PII 后还原）', async () => {
    const config = makeConfig({
      provider: 'deepl',
      mask: true,
      glossary: [{ src: 'Transformer', dst: '变压器' }],
    })
    const text = 'Mail alice@example.com about the Transformer paper'
    vi.mocked(ENGINES.deepl.translate).mockImplementation(async (t: string) => {
      // 引擎收到的是 mask 后、glossary 注入后的文本
      expect(t).toBe('Mail __PII_EMAIL_1__ about the __GLOSSARY_1__ paper')
      return { text: '关于 __GLOSSARY_1__ 的论文已发给 __PII_EMAIL_1__' }
    })
    const r = await translate(text, { targetLang: 'zh-CN' }, config)
    // 逆序还原：glossary dst 写回 + PII 原值写回
    expect(r.text).toBe('关于 变压器 的论文已发给 alice@example.com')
    expect(ENGINES.deepl.translate).toHaveBeenCalledTimes(1)
  })

  it('glossary 术语译文还原（无 mask）', async () => {
    const config = makeConfig({
      provider: 'deepl',
      glossary: [{ src: 'Transformer', dst: '变压器' }],
    })
    vi.mocked(ENGINES.deepl.translate).mockImplementation(async (t: string) => {
      expect(t).toBe('__GLOSSARY_1__ is great')
      return { text: '__GLOSSARY_1__ 很棒' }
    })
    const r = await translate('Transformer is great', { targetLang: 'zh-CN' }, config)
    expect(r.text).toBe('变压器 很棒')
  })
})

// ---------- 免费链降级 + 冷却 ----------

describe('免费链', () => {
  it('配置引擎失败 → 冷却沉底依次降级；冷却期内跳过；60s 后恢复重试', async () => {
    vi.useFakeTimers()
    const config = makeConfig({ provider: 'google' })
    vi.mocked(ENGINES.google.translate).mockRejectedValue(new Error('google down'))

    const r1 = await translate('hello', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
    expect(ENGINES.bing.translate).toHaveBeenCalledTimes(1)
    expect(r1.text).toBe('[bing]hello')

    // google 冷却中：只打 bing
    const r2 = await translate('world', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
    expect(ENGINES.bing.translate).toHaveBeenCalledTimes(2)
    expect(r2.text).toBe('[bing]world')

    // 推进 61s，冷却过期 → google 重新尝试并再次失败沉底
    vi.advanceTimersByTime(61_000)
    const r3 = await translate('again', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(2)
    expect(r3.text).toBe('[bing]again')
  })

  it('配置引擎非链首时仍优先（google 冷却沉底后用 bing 起步）', async () => {
    vi.useFakeTimers()
    const config = makeConfig({ provider: 'bing' })
    vi.mocked(ENGINES.bing.translate).mockRejectedValue(new Error('bing down'))
    const r = await translate('hi', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.bing.translate).toHaveBeenCalledTimes(1)
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
    expect(r.text).toBe('[google]hi')
  })

  it('全链失败抛合并错误（含各引擎错误信息）', async () => {
    for (const id of ['google', 'bing', 'mymemory']) {
      vi.mocked(ENGINES[id].translate).mockRejectedValue(new Error(`${id} err`))
    }
    await expect(
      translate('x', { targetLang: 'zh-CN' }, makeConfig({ provider: 'google' })),
    ).rejects.toThrow(/all free engines failed.*google.*bing.*mymemory/s)
  })

  it('BYOK 不进链：失败直接抛出，免费引擎零调用', async () => {
    const config = makeConfig({ provider: 'deepl' })
    vi.mocked(ENGINES.deepl.translate).mockRejectedValue(new Error('401 bad key'))
    await expect(translate('hi', { targetLang: 'zh-CN' }, config)).rejects.toThrow('401 bad key')
    expect(ENGINES.google.translate).not.toHaveBeenCalled()
    expect(ENGINES.bing.translate).not.toHaveBeenCalled()
    expect(ENGINES.mymemory.translate).not.toHaveBeenCalled()
  })
})

// ---------- 缓存 ----------

describe('缓存', () => {
  it('命中直接返回，不请求引擎', async () => {
    const config = makeConfig({ provider: 'deepl' })
    cacheStore.set('k|deepl|hello', '缓存译文')
    const r = await translate('hello', { targetLang: 'zh-CN' }, config)
    expect(r.text).toBe('缓存译文')
    expect(ENGINES.deepl.translate).not.toHaveBeenCalled()
  })

  it('未命中请求引擎并写缓存；缓存 key 含引擎 id 与原文', async () => {
    const config = makeConfig({ provider: 'deepl' })
    const r = await translate('new text', { targetLang: 'zh-CN' }, config)
    expect(r.text).toBe('[deepl]new text')
    expect(cacheStore.get('k|deepl|new text')).toBe('[deepl]new text')
  })
})

// ---------- 批聚合 ----------

describe('批聚合', () => {
  it('translate 单条在批开启时走 BatchQueue（节流窗口后聚合发出）', async () => {
    vi.useFakeTimers()
    const config = makeConfig({ provider: 'openai', batch: true })
    const p = translate('hello', { targetLang: 'zh-CN' }, config)
    await vi.advanceTimersByTimeAsync(config.batch.intervalMs)
    const r = await p
    expect(ENGINES.openai.translateBatch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ENGINES.openai.translateBatch!).mock.calls[0][0]).toEqual(['hello'])
    expect(r.text).toBe('[openai:batch]hello')
  })

  it('translateTexts：一批送 translateBatch 并逐条还原术语占位符', async () => {
    const config = makeConfig({
      provider: 'openai',
      batch: true,
      glossary: [{ src: 'Transformer', dst: '变压器' }],
    })
    vi.mocked(ENGINES.openai.translateBatch!).mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => `译文${i} __GLOSSARY_1__`),
    )
    const out = await translateTexts(
      ['hello Transformer', 'bye Transformer'],
      { targetLang: 'zh-CN' },
      config,
    )
    expect(ENGINES.openai.translateBatch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ENGINES.openai.translateBatch!).mock.calls[0][0]).toEqual([
      'hello __GLOSSARY_1__',
      'bye __GLOSSARY_1__',
    ])
    expect(out).toEqual(['译文0 变压器', '译文1 变压器'])
    // 逐条写缓存
    expect(cacheStore.get('k|openai|hello Transformer')).toBe('译文0 变压器')
  })

  it('translateTexts：批失败回退逐条单发，仍逐条还原', async () => {
    const config = makeConfig({
      provider: 'openai',
      batch: true,
      glossary: [{ src: 'Transformer', dst: '变压器' }],
    })
    vi.mocked(ENGINES.openai.translateBatch!).mockRejectedValue(new Error('batch exploded'))
    vi.mocked(ENGINES.openai.translate).mockImplementation(async (t: string) => ({
      text: `单发:${t}`,
    }))
    const out = await translateTexts(['hi Transformer'], { targetLang: 'zh-CN' }, config)
    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(1)
    expect(out).toEqual(['单发:hi 变压器'])
  })

  it('translateTexts：非批引擎逐条走单发管线', async () => {
    const config = makeConfig({ provider: 'google' })
    const out = await translateTexts(['aa', 'bb'], { targetLang: 'zh-CN' }, config)
    expect(out).toEqual(['[google]aa', '[google]bb'])
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(2)
  })

  it('translateTexts：缓存命中条目不重复请求', async () => {
    const config = makeConfig({ provider: 'google' })
    cacheStore.set('k|google|aa', '缓存aa')
    const out = await translateTexts(['aa', 'bb'], { targetLang: 'zh-CN' }, config)
    expect(out).toEqual(['缓存aa', '[google]bb'])
    expect(ENGINES.google.translate).toHaveBeenCalledTimes(1)
  })
})

// ---------- detectLang ----------

describe('detectLang', () => {
  it('优先 google auto 检测取 detectedLang', async () => {
    vi.mocked(ENGINES.google.translate).mockResolvedValue({ text: 'x', detectedLang: 'fr' })
    expect(await detectLang('hello world', makeConfig())).toBe('fr')
  })

  it('google 失败回退本地正文推断', async () => {
    vi.mocked(ENGINES.google.translate).mockRejectedValue(new Error('offline'))
    expect(await detectLang('这是一个中文句子用来测试', makeConfig())).toBe('zh-CN')
    expect(await detectLang('これは日本語のテキストです', makeConfig())).toBe('ja')
  })
})
