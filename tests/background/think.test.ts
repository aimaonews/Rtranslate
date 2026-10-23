import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'
import type { EngineContext } from '../../src/background/engines'
import { setFetchImpl } from '../../src/background/engines'
import {
  deepseekEngine,
  openaiEngine,
  parseBatchResponse,
  stripThinking,
} from '../../src/background/engines/openaiCompat'

// ---------- 测试基础设施（与 engines.test.ts 同款） ----------

function makeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => handler(url, init))
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { role: 'assistant', content } }] })
}

/** 带 OpenAI 兼容 key 的 ctx（openaiEngine/deepseekEngine 需要）。 */
function llmCtx(patch?: (c: Config) => void): EngineContext {
  const config = structuredClone(DEFAULT_CONFIG)
  config.engine.keys.openai = 'sk-test'
  patch?.(config)
  return { config }
}

// ---------- stripThinking 单元 ----------

describe('stripThinking', () => {
  it('剥离 <think> 块并 trim', () => {
    expect(stripThinking('<think>推理过程</think>译文')).toBe('译文')
    expect(stripThinking('  <think>推理</think>  译文  ')).toBe('译文')
  })

  it('跨行思维链也剥离', () => {
    expect(stripThinking('<think>第一行\n第二行\n第三行</think>译文')).toBe('译文')
  })

  it('大小写不敏感', () => {
    expect(stripThinking('<THINK>推理</THINK>译文')).toBe('译文')
    expect(stripThinking('<Think>推理</ThInK>译文')).toBe('译文')
  })

  it('剥离 <thinking> 变体', () => {
    expect(stripThinking('<thinking>推理过程</thinking>译文')).toBe('译文')
    expect(stripThinking('<Thinking>多\n行</Thinking>译文')).toBe('译文')
  })

  it('多个 think 块全部剥离', () => {
    expect(stripThinking('<think>a</think>译<think>b</think>文')).toBe('译文')
  })

  it('无标签正常文本原样返回', () => {
    expect(stripThinking('正常文本')).toBe('正常文本')
    expect(stripThinking('包含 <b>标签</b> 但不是 think')).toBe('包含 <b>标签</b> 但不是 think')
  })

  it('只有标签时返回原文兜底，绝不丢内容', () => {
    const only = '<think>只有推理，没有译文</think>'
    expect(stripThinking(only)).toBe(only)
    const onlyThinking = '<thinking>推理</thinking>  \n'
    expect(stripThinking(onlyThinking)).toBe(onlyThinking)
  })

  it('开闭标签种类不匹配时不剥离', () => {
    expect(stripThinking('<think>推理</thinking>译文')).toBe('<think>推理</thinking>译文')
  })
})

// ---------- 引擎集成：单发 ----------

describe('openaiCompat 思维链剥离（单发）', () => {
  it('DeepSeek-R1 风格 <think> 前缀被剥离', async () => {
    setFetchImpl(
      makeFetch(() => chatResponse('<think>用户说 hello，要译成中文，应该是「你好」。</think>你好'))
    )
    const res = await deepseekEngine.translate('hello', 'auto', 'zh-CN', llmCtx())
    expect(res.text).toBe('你好')
  })

  it('跨行推理 + 大小写混合标签', async () => {
    setFetchImpl(
      makeFetch(() => chatResponse('<Thinking>第一步：理解原文\n第二步：给出译文</Thinking>  你好，世界  '))
    )
    const res = await openaiEngine.translate('hello world', 'auto', 'zh-CN', llmCtx())
    expect(res.text).toBe('你好，世界')
  })

  it('无标签正常文本不受影响', async () => {
    setFetchImpl(makeFetch(() => chatResponse('你好，世界')))
    const res = await openaiEngine.translate('hello world', 'auto', 'zh-CN', llmCtx())
    expect(res.text).toBe('你好，世界')
  })

  it('响应只有 think 块时返回原文兜底', async () => {
    const only = '<think>推理但忘记输出译文</think>'
    setFetchImpl(makeFetch(() => chatResponse(only)))
    const res = await openaiEngine.translate('hello', 'auto', 'zh-CN', llmCtx())
    expect(res.text).toBe(only)
  })
})

// ---------- 引擎集成：批量 ----------

describe('openaiCompat 思维链剥离（批量）', () => {
  it('混合响应逐条剥离：带标签 / 正常 / <thinking> 变体', async () => {
    setFetchImpl(
      makeFetch(() =>
        chatResponse(
          '{"translations":[' +
            '{"id":1,"text":"<think>推理</think>你好"},' +
            '{"id":2,"text":"世界"},' +
            '{"id":3,"text":"<thinking>多\\n行推理</thinking>再一次"}' +
            ']}'
        )
      )
    )
    const out = await openaiEngine.translateBatch!(['hello', 'world', 'again'], 'auto', 'zh-CN', llmCtx())
    expect(out).toEqual(['你好', '世界', '再一次'])
  })

  it('某条剥离后为空时保留该条原文本，其余正常剥离', async () => {
    const only = '<think>只有推理</think>'
    setFetchImpl(
      makeFetch(() =>
        chatResponse(
          `{"translations":[{"id":1,"text":${JSON.stringify(only)}},{"id":2,"text":"世界"}]}`
        )
      )
    )
    const out = await openaiEngine.translateBatch!(['hello', 'world'], 'auto', 'zh-CN', llmCtx())
    expect(out).toEqual([only, '世界'])
  })

  it('缺条仍用原文兜底，幻觉条目忽略（剥离不影响容错）', async () => {
    setFetchImpl(
      makeFetch(() =>
        chatResponse(
          '{"translations":[{"id":1,"text":"<think>r</think>你好"},{"id":99,"text":"??"},{"id":3,"text":"再一次"}]}'
        )
      )
    )
    const out = await openaiEngine.translateBatch!(['hello', 'world', 'again'], 'auto', 'zh-CN', llmCtx())
    expect(out).toEqual(['你好', 'world', '再一次'])
  })
})

// ---------- parseBatchResponse 直测 ----------

describe('parseBatchResponse 思维链剥离', () => {
  it('解析后逐条剥离 think 块', () => {
    const out = parseBatchResponse(
      '{"translations":[{"id":1,"text":"<think>推理</think>甲"},{"id":2,"text":"乙"}]}',
      ['a', 'b']
    )
    expect(out).toEqual(['甲', '乙'])
  })
})
