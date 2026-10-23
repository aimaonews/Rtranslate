/**
 * AI 专家（experts）单测：
 * - renderExpertPrompt：占位符替换 + 空 glossary 行删除
 * - getExpert：id 命中与回退
 * - openaiCompat 引擎：system/user prompt 按当前激活专家构造（mock fetch 验证请求体）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import type { EngineContext } from '../../src/background/engines'
import { setFetchImpl } from '../../src/background/engines'
import { openaiEngine } from '../../src/background/engines/openaiCompat'
import { BUILTIN_EXPERTS, getExpert, renderExpertPrompt } from '../../src/core/experts'
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

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function llmCtx(patch?: (c: Config) => void): EngineContext {
  const config = structuredClone(DEFAULT_CONFIG)
  config.engine.keys.openai = 'sk-test'
  patch?.(config)
  return { config }
}

/** 抓最近一次请求的 chat body。 */
function lastBody(): { messages: Array<{ role: string; content: string }>; model: string; temperature: number } {
  return JSON.parse(calls[calls.length - 1].init?.body as string)
}

beforeEach(() => {
  calls = []
})

// ---------- renderExpertPrompt ----------

describe('renderExpertPrompt', () => {
  it('替换 {{text}} {{to}} {{from}} {{glossary}} 全部占位符', () => {
    const out = renderExpertPrompt('From {{from}} to {{to}}:\n{{glossary}}\n{{text}}', {
      text: 'hello',
      to: 'Simplified Chinese',
      from: 'en',
      glossary: '- a → b',
    })
    expect(out).toBe('From en to Simplified Chinese:\n- a → b\nhello')
  })

  it('glossary 为空时删除含 {{glossary}} 的整行，其余行保留', () => {
    const out = renderExpertPrompt('Translate to {{to}}.\nTerms:\n{{glossary}}\nText: {{text}}', {
      text: 'hi',
      to: 'English',
      from: 'auto',
    })
    expect(out).toBe('Translate to English.\nTerms:\nText: hi')
    expect(out).not.toContain('{{glossary}}')
  })

  it('glossary 非空时该行被替换保留', () => {
    const out = renderExpertPrompt('{{glossary}}\n{{text}}', {
      text: 'hi',
      to: 'English',
      from: 'auto',
      glossary: '- Transformer → 变压器',
    })
    expect(out).toBe('- Transformer → 变压器\nhi')
  })

  it('同一占位符多次出现全部替换', () => {
    const out = renderExpertPrompt('{{text}} / {{text}}', {
      text: 'x',
      to: 'English',
      from: 'auto',
    })
    expect(out).toBe('x / x')
  })
})

// ---------- getExpert ----------

describe('getExpert', () => {
  it('按 id 命中列表中的专家（含自定义）', () => {
    const custom = { id: 'custom-1', name: '自定义', builtin: false, systemPrompt: 'S', userPrompt: 'U' }
    const list = [...BUILTIN_EXPERTS, custom]
    expect(getExpert(list, 'tech').name).toBe('技术文档')
    expect(getExpert(list, 'custom-1')).toBe(custom)
  })

  it('id 未命中时回退内置「通用」', () => {
    expect(getExpert(BUILTIN_EXPERTS, 'no-such-id')).toBe(BUILTIN_EXPERTS[0])
  })

  it('空列表同样回退内置「通用」', () => {
    expect(getExpert([], 'tech')).toBe(BUILTIN_EXPERTS[0])
  })
})

// ---------- openaiCompat 引擎：专家 prompt 注入 ----------

describe('openaiCompat 引擎按激活专家构造 prompt', () => {
  it('激活「技术文档」专家：system 含专家 systemPrompt + 目标语言全名 + 只输出译文', async () => {
    setFetchImpl(makeFetch(() => chatResponse('译')))
    const ctx = llmCtx((c) => {
      c.experts.activeId = 'tech'
    })
    await openaiEngine.translate('hello', 'en', 'zh-CN', ctx)
    const sys = lastBody().messages[0].content
    const tech = BUILTIN_EXPERTS.find((e) => e.id === 'tech')!
    expect(sys).toContain(tech.systemPrompt)
    expect(sys).toContain('Simplified Chinese')
    expect(sys).toContain('Output only the translation')
  })

  it('单发 user prompt 用专家模板渲染（{{text}}/{{to}}/{{from}}）', async () => {
    setFetchImpl(makeFetch(() => chatResponse('译')))
    const custom = {
      id: 'custom-x',
      name: 'X',
      builtin: false,
      systemPrompt: 'You are a custom expert.',
      userPrompt: 'SRC[{{from}}] DST[{{to}}]\n{{text}}',
    }
    const ctx = llmCtx((c) => {
      c.experts = { activeId: 'custom-x', list: [...BUILTIN_EXPERTS, custom] }
    })
    await openaiEngine.translate('hello', 'en', 'zh-CN', ctx)
    const body = lastBody()
    expect(body.messages[0].content).toContain('You are a custom expert.')
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'SRC[en] DST[Simplified Chinese]\nhello',
    })
  })

  it('activeId 无效时回退「通用」专家', async () => {
    setFetchImpl(makeFetch(() => chatResponse('译')))
    const ctx = llmCtx((c) => {
      c.experts.activeId = 'no-such-expert'
    })
    await openaiEngine.translate('hello', 'en', 'zh-CN', ctx)
    const body = lastBody()
    expect(body.messages[0].content).toContain(BUILTIN_EXPERTS[0].systemPrompt)
    expect(body.messages[1].content).toBe(
      'Translate the following text into Simplified Chinese. Output only the translation, no explanations:\n\nhello',
    )
  })

  it('PII 保护句与 glossary 块保留在 system 中', async () => {
    setFetchImpl(makeFetch(() => chatResponse('译')))
    const ctx = llmCtx((c) => {
      c.glossary = [{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }]
    })
    await openaiEngine.translate('mail __PII_EMAIL_1__', 'en', 'zh-CN', ctx)
    const sys = lastBody().messages[0].content
    expect(sys).toContain(PII_PROTECT_NOTE)
    expect(sys).toContain(glossaryPromptBlock([{ src: 'Transformer', dst: 'Transformer（变压器式模型）' }]))
  })

  it('批量：编号 JSON 协议不变，批协议指令后置追加在专家 prompt 之后', async () => {
    setFetchImpl(makeFetch(() => chatResponse('{"translations":[{"id":1,"text":"你好"}]}')))
    const ctx = llmCtx((c) => {
      c.experts.activeId = 'literary'
    })
    const out = await openaiEngine.translateBatch!(['hello'], 'en', 'zh-CN', ctx)
    expect(out).toEqual(['你好'])
    const body = lastBody()
    const sys = body.messages[0].content
    const literary = BUILTIN_EXPERTS.find((e) => e.id === 'literary')!
    const batchNote =
      'Output a single JSON object of the form {"translations":[{"id":number,"text":"translation"}]} containing all items, ids must match input.'
    expect(sys).toContain(literary.systemPrompt)
    // 批协议指令位于专家 prompt 之后（不可被用户 prompt 覆盖）
    expect(sys.indexOf(batchNote)).toBeGreaterThan(sys.indexOf(literary.systemPrompt))
    expect(sys.trimEnd().endsWith(batchNote)).toBe(true)
    // user 仍是编号 JSON 批协议，而非专家模板
    expect(body.messages[1].content).toBe(JSON.stringify({ id: 1, text: 'hello' }))
  })
})
