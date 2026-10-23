// @vitest-environment jsdom
// 全页摘要上下文感知（contextAware）：page.ts 提取/传递 + translate.ts 注入/缓存隔离。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import { ENGINES } from '../../src/background/engines'
import { resetBatchQueues } from '../../src/background/batch'
import { translate, resetCooldowns, pageContextBlock } from '../../src/background/translate'
import { getExpert } from '../../src/core/experts'
import { getPageContext, resetPageContext, translateElement } from '../../src/content/page'

// ---------- mock：engines 注册表 + 缓存 + chrome ----------

const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, string>() }))

const sendMessageMock = vi.fn(async (_msg: unknown) => ({ ok: true, data: { text: '这是与原文不同的译文。' } }))

vi.stubGlobal('chrome', {
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
  runtime: {
    sendMessage: sendMessageMock,
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
    // 不在 AI provider 名单但 supportsBatch：验证 supportsBatch 分支也算 AI 类
    custom: makeEngine('custom', 'byok', true),
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
  // key 带 promptSig 段：上下文签名差异必须体现为不同 key
  cacheKey: (p: { engine: string; text: string; promptSig?: string }) =>
    `k|${p.engine}|${p.text}|${p.promptSig ?? ''}`,
  get: vi.fn(async (k: string) => cacheStore.get(k)),
  set: vi.fn(async (k: string, v: string) => {
    cacheStore.set(k, v)
  }),
  clearAll: vi.fn(async () => cacheStore.clear()),
}))

// ---------- 测试工具 ----------

function makeConfig(patch?: {
  provider?: Config['engine']['provider']
  batch?: boolean
  contextAware?: boolean
}): Config {
  const c = structuredClone(DEFAULT_CONFIG)
  if (patch?.provider) c.engine.provider = patch.provider
  if (patch?.batch !== undefined) c.batch.enabled = patch.batch
  if (patch?.contextAware !== undefined) c.contextAware.enabled = patch.contextAware
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

/** 引擎实际收到的 config 的激活专家 systemPrompt（openaiCompat 即据此构造 system prompt）。 */
function systemPromptOf(config: Config): string {
  return getExpert(config.experts.list, config.experts.activeId).systemPrompt
}

beforeEach(() => {
  vi.useRealTimers()
  cacheStore.clear()
  sendMessageMock.mockClear()
  resetBatchQueues()
  resetCooldowns()
  resetPageContext()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.title = ''
  for (const e of Object.values(ENGINES)) installDefaults(e)
})

// ---------- context 注入 system prompt（AI 引擎） ----------

describe('context 注入 system prompt（AI 引擎）', () => {
  it('openai 单发：激活专家 systemPrompt 前置 <page_context> 块，原 config 不被污染', async () => {
    const config = makeConfig({ provider: 'openai', batch: false })
    const ctx = 'Title: Example\nAn article about transformers and attention.'
    await translate('hello', { targetLang: 'zh-CN', context: ctx }, config)

    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(1)
    const engineCtx = vi.mocked(ENGINES.openai.translate).mock.calls[0][3]
    const sp = systemPromptOf(engineCtx.config)
    expect(sp).toContain(`<page_context>\n${ctx}\n</page_context>`)
    expect(sp).toContain('Use it only to resolve references and terminology; do not translate it.')
    // 上下文块位于最前（buildSystemPrompt 以专家 systemPrompt 开头）
    expect(sp.indexOf('<page_context>')).toBe(0)
    // 注入发生在克隆上：调用方 config 保持原样
    expect(systemPromptOf(config)).not.toContain('<page_context>')
  })

  it('pageContextBlock 格式契约', () => {
    expect(pageContextBlock('X')).toBe(
      '<page_context>\nX\n</page_context>\n' +
        'Use it only to resolve references and terminology; do not translate it.',
    )
  })

  it('supportsBatch 的非名单引擎（custom）同样注入', async () => {
    const config = makeConfig({ provider: 'custom', batch: false })
    await translate('hello', { targetLang: 'zh-CN', context: 'Page Ctx' }, config)
    const engineCtx = vi.mocked(ENGINES.custom.translate).mock.calls[0][3]
    expect(systemPromptOf(engineCtx.config)).toContain('<page_context>\nPage Ctx\n</page_context>')
  })

  it('批路径：translateBatch 收到的 config 同样注入；同上下文聚合成一批', async () => {
    vi.useFakeTimers()
    const config = makeConfig({ provider: 'openai', batch: true })
    const p1 = translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    const p2 = translate('world', { targetLang: 'zh-CN', context: 'Page A' }, config)
    await vi.advanceTimersByTimeAsync(config.batch.intervalMs)
    await Promise.all([p1, p2])
    expect(ENGINES.openai.translateBatch).toHaveBeenCalledTimes(1)
    const batchCtx = vi.mocked(ENGINES.openai.translateBatch!).mock.calls[0][3]
    expect(systemPromptOf(batchCtx.config)).toContain('<page_context>\nPage A\n</page_context>')
  })

  it('批路径：不同上下文的 system prompt 不同，队列隔离不混批', async () => {
    vi.useFakeTimers()
    const config = makeConfig({ provider: 'openai', batch: true })
    const p1 = translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    const p2 = translate('world', { targetLang: 'zh-CN', context: 'Page B' }, config)
    await vi.advanceTimersByTimeAsync(config.batch.intervalMs)
    await Promise.all([p1, p2])
    // 两个上下文签名 → 两个队列 → 各发一批
    expect(ENGINES.openai.translateBatch).toHaveBeenCalledTimes(2)
  })
})

// ---------- 机器引擎忽略 context ----------

describe('机器引擎忽略 context', () => {
  it('google（免费链）：config 原样传递，缓存 key 不含上下文签名', async () => {
    const config = makeConfig({ provider: 'google' })
    const r = await translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    expect(r.text).toBe('[google]hello')
    const engineCtx = vi.mocked(ENGINES.google.translate).mock.calls[0][3]
    expect(engineCtx.config).toBe(config) // 同一对象引用：未做注入克隆
    expect(systemPromptOf(engineCtx.config)).not.toContain('<page_context>')
    expect([...cacheStore.keys()][0]).not.toContain('ctx:')
  })

  it('deepl（BYOK 非 AI）：config 原样传递', async () => {
    const config = makeConfig({ provider: 'deepl' })
    await translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    const engineCtx = vi.mocked(ENGINES.deepl.translate).mock.calls[0][3]
    expect(engineCtx.config).toBe(config)
    expect([...cacheStore.keys()][0]).not.toContain('ctx:')
  })
})

// ---------- 缓存 key 含上下文签名 ----------

describe('缓存 key 含上下文签名', () => {
  it('同文不同上下文 key 不同；同上下文命中缓存；无上下文又是另一个 key', async () => {
    const config = makeConfig({ provider: 'openai', batch: false })
    await translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    await translate('hello', { targetLang: 'zh-CN', context: 'Page B' }, config)
    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(2)

    const keys = [...cacheStore.keys()]
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys.every((k) => k.includes('ctx:'))).toBe(true)

    // 同上下文同文：缓存命中，不再请求引擎
    const r = await translate('hello', { targetLang: 'zh-CN', context: 'Page A' }, config)
    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(2)
    expect(r.text).toBe('[openai]hello')

    // 无上下文：第三个独立 key
    await translate('hello', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(3)
    expect([...cacheStore.keys()]).toHaveLength(3)
  })
})

// ---------- 无 context 兼容 ----------

describe('无 context 兼容', () => {
  it('不传 context：行为与旧版一致（key 无 ctx 段、config 原样、二次命中缓存）', async () => {
    const config = makeConfig({ provider: 'openai', batch: false })
    await translate('hello', { targetLang: 'zh-CN' }, config)
    await translate('hello', { targetLang: 'zh-CN' }, config)
    expect(ENGINES.openai.translate).toHaveBeenCalledTimes(1)
    const engineCtx = vi.mocked(ENGINES.openai.translate).mock.calls[0][3]
    expect(engineCtx.config).toBe(config)
    expect([...cacheStore.keys()][0]).not.toContain('ctx:')
  })

  it('空白 context 视为无 context', async () => {
    const config = makeConfig({ provider: 'openai', batch: false })
    await translate('hello', { targetLang: 'zh-CN', context: '   \n  ' }, config)
    const engineCtx = vi.mocked(ENGINES.openai.translate).mock.calls[0][3]
    expect(engineCtx.config).toBe(config)
    expect([...cacheStore.keys()][0]).not.toContain('ctx:')
  })
})

// ---------- getPageContext：提取、截断、缓存 ----------

describe('getPageContext', () => {
  it('标题 + meta description + 正文拼接，正文空白归一化', () => {
    // 注意顺序：head.innerHTML 赋值会冲掉已有 <title>，先放 meta 再设 title
    document.head.innerHTML = '<meta name="description" content="A site about testing">'
    document.title = 'My Page'
    document.body.innerHTML = '<p>Hello    world\n  foo bar</p>'
    const ctx = getPageContext()
    expect(ctx).toBe('My Page\nA site about testing\nHello world foo bar')
  })

  it('description 截 200、正文截 400、总长截 800', () => {
    document.head.innerHTML = `<meta name="description" content="${'d'.repeat(300)}">`
    document.title = 't'.repeat(300)
    document.body.innerHTML = `<p>${'b'.repeat(600)}</p>`
    const ctx = getPageContext() as string
    // 300(title) + 1 + 200(desc) + 1 + 400(body) = 902 → 截到 800
    expect(ctx.length).toBe(800)
    expect(ctx.startsWith('t'.repeat(300))).toBe(true)
    expect(ctx).toContain('d'.repeat(200))
    expect(ctx).not.toContain('d'.repeat(201))
  })

  it('仅 description 超长时截到 200', () => {
    document.head.innerHTML = `<meta name="description" content="${'d'.repeat(300)}">`
    const ctx = getPageContext() as string
    expect(ctx.length).toBe(200)
  })

  it('页面无任何可用片段返回 undefined', () => {
    expect(getPageContext()).toBeUndefined()
  })

  it('模块级缓存一次：DOM 变更后不重取，resetPageContext 后重新提取', () => {
    document.title = 'First'
    expect(getPageContext()).toBe('First')
    document.title = 'Second'
    expect(getPageContext()).toBe('First') // 缓存生效
    resetPageContext()
    expect(getPageContext()).toBe('Second')
  })
})

// ---------- requestTranslate 传递 context（translateElement 通路） ----------

describe('requestTranslate 传递 context', () => {
  it('contextAware.enabled=true：translate 消息带页面上下文', async () => {
    document.title = 'My Page'
    document.body.innerHTML = '<p>Hello world, this is a test sentence.</p>'
    const config = makeConfig({ contextAware: true })
    const el = document.querySelector('p') as Element
    const okFlag = await translateElement(el, config)
    expect(okFlag).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    const msg = sendMessageMock.mock.calls[0][0] as Record<string, unknown>
    expect(msg.kind).toBe('translate')
    expect(msg.context).toBe('My Page\nHello world, this is a test sentence.')
  })

  it('contextAware.enabled=false：translate 消息不带 context 字段', async () => {
    document.title = 'My Page'
    document.body.innerHTML = '<p>Hello world, this is a test sentence.</p>'
    const config = makeConfig({ contextAware: false })
    const el = document.querySelector('p') as Element
    const okFlag = await translateElement(el, config)
    expect(okFlag).toBe(true)
    const msg = sendMessageMock.mock.calls[0][0] as Record<string, unknown>
    expect(msg.kind).toBe('translate')
    expect(msg).not.toHaveProperty('context')
  })
})
