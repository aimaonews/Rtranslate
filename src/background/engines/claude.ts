// Claude（Anthropic）原生 AI 引擎：POST /v1/messages 协议。
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

const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TEMPERATURE = 0.1

interface ClaudeMessagesResponse {
  content?: Array<{ type?: string; text?: unknown }>
  error?: { message?: string }
}

export function createClaudeEngine(): Engine {
  async function callMessages(body: unknown, ctx: EngineContext, signal?: AbortSignal): Promise<string> {
    const apiKey = ctx.config.engine.keys.claude
    if (!apiKey) {
      throw new Error(
        'claude: missing API key. Open the Rtranslate options page and fill in the Claude API key field.'
      )
    }
    const res = await getFetch()(CLAUDE_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // 浏览器扩展直连 Anthropic 官方端点必须显式声明（CORS 放行头）
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw httpError('claude', res)
    const data = (await res.json()) as ClaudeMessagesResponse
    if (data.error?.message) throw new Error(`claude: ${data.error.message}`)
    const text = data.content?.[0]?.text
    if (typeof text !== 'string') throw new Error('claude: unexpected response shape')
    return text.trim()
  }

  return {
    id: 'claude',
    name: 'Claude (Anthropic)',
    kind: 'byok',
    requiresKey: true,
    supportsBatch: true,

    async translate(text, from, to, ctx, signal): Promise<EngineResult> {
      const system = buildSystemPrompt(to, { pii: text.includes('__PII_'), config: ctx.config })
      const content = await callMessages(
        {
          model: ctx.config.engine.claude.model || DEFAULT_MODEL,
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: DEFAULT_TEMPERATURE,
          system,
          messages: [{ role: 'user', content: buildUserPrompt(text, from, to, ctx.config) }],
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
      const content = await callMessages(
        {
          model: ctx.config.engine.claude.model || DEFAULT_MODEL,
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: DEFAULT_TEMPERATURE,
          system,
          messages: [{ role: 'user', content: encodeBatchPayload(texts) }],
        },
        ctx,
        signal
      )
      return parseBatchResponse(content, texts)
    },
  }
}

export const claudeEngine = createClaudeEngine()
