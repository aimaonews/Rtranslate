// Gemini（Google）原生 AI 引擎：generateContent 协议，key 走 URL query。
// system prompt 构造、编号 JSON 批协议、stripThinking 全部复用 openaiCompat 的导出，
// 保证各 AI 引擎的 prompt 行为一致（专家策略 / PII 保护句 / 术语块 / 批协议指令）。
import {
  buildSystemPrompt,
  buildUserPrompt,
  encodeBatchPayload,
  parseBatchResponse,
  stripThinking,
} from './openaiCompat'
import type { Engine, EngineContext, EngineResult } from './types'
import { getFetch, httpError } from './fetch'

const GEMINI_MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_TEMPERATURE = 0.1

interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  error?: { message?: string }
}

export function createGeminiEngine(): Engine {
  async function callGenerate(body: unknown, ctx: EngineContext, signal?: AbortSignal): Promise<string> {
    const apiKey = ctx.config.engine.keys.gemini
    if (!apiKey) {
      throw new Error(
        'gemini: missing API key. Open the Rtranslate options page and fill in the Gemini API key field.'
      )
    }
    const model = ctx.config.engine.gemini.model || DEFAULT_MODEL
    const url = `${GEMINI_MODELS_BASE}/${model}:generateContent?key=${apiKey}`
    const res = await getFetch()(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw httpError('gemini', res)
    const data = (await res.json()) as GeminiGenerateResponse
    if (data.error?.message) throw new Error(`gemini: ${data.error.message}`)
    const parts = data.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) throw new Error('gemini: unexpected response shape')
    // Gemini 可能把答案拆成多个 part，全部拼接（忽略非字符串项）
    return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
  }

  return {
    id: 'gemini',
    name: 'Gemini (Google)',
    kind: 'byok',
    requiresKey: true,
    supportsBatch: true,

    async translate(text, from, to, ctx, signal): Promise<EngineResult> {
      const system = buildSystemPrompt(to, { pii: text.includes('__PII_'), config: ctx.config })
      const content = await callGenerate(
        {
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text, from, to, ctx.config) }] }],
          generationConfig: { temperature: DEFAULT_TEMPERATURE },
        },
        ctx,
        signal
      )
      return { text: stripThinking(content) }
    },

    async translateBatch(texts, _from, to, ctx, signal) {
      if (texts.length === 0) return []
      const system = buildSystemPrompt(to, {
        pii: texts.some((t) => t.includes('__PII_')),
        config: ctx.config,
        batch: true,
      })
      const content = await callGenerate(
        {
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: encodeBatchPayload(texts) }] }],
          generationConfig: { temperature: DEFAULT_TEMPERATURE },
        },
        ctx,
        signal
      )
      return parseBatchResponse(content, texts)
    },
  }
}

export const geminiEngine = createGeminiEngine()
