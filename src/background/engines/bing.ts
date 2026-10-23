import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

// Edge 免费 JWT 端点（MTranBrowser microsoft.ts 的路线）：先 GET auth 拿 JWT，
// 本地解析 payload.exp 缓存，提前 5 分钟视为过期——边界时刻 token 在飞行途中失效
// 会换来一整批 401，宁可多取一次。
const AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000
/** exp 解析失败时的兜底缓存时长（JWT 实际寿命约 10 分钟） */
const TOKEN_FALLBACK_TTL_MS = 10 * 60 * 1000

let cachedToken: { token: string; expiresAt: number } | null = null

/** base64url 解码 JWT payload 取 exp（秒级）；失败返回 null。 */
function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

async function getToken(signal?: AbortSignal): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token
  const res = await getFetch()(AUTH_URL, { signal })
  if (!res.ok) throw httpError('bing auth', res)
  const token = (await res.text()).trim()
  if (!token) throw new Error('bing: empty auth token')
  const expMs = decodeJwtExpMs(token)
  cachedToken = {
    token,
    expiresAt: expMs !== null ? expMs - TOKEN_EXPIRY_SKEW_MS : Date.now() + TOKEN_FALLBACK_TTL_MS,
  }
  return token
}

/** 测试钩子：清空模块级 token 缓存，避免用例间串扰。 */
export function resetBingTokenCache(): void {
  cachedToken = null
}

/**
 * 语言码映射：Bing 用 zh-Hans/zh-Hant 区分简繁；其余语言用主码（en-US→en）。
 * 'auto' 由调用方处理（自动检测时不传 from 参数）。
 */
export function toBingLang(code: string): string {
  const c = code.trim().toLowerCase()
  if (c === 'zh' || c.startsWith('zh-') || c.startsWith('zh_')) {
    return /tw|hk|mo|hant/.test(c) ? 'zh-Hant' : 'zh-Hans'
  }
  return c.split('-')[0]
}

interface BingItem {
  translations?: Array<{ text?: string }>
  detectedLanguage?: { language?: string }
}

export const bingEngine: Engine = {
  id: 'bing',
  name: 'Microsoft Translator (free)',
  kind: 'free',
  maxTextLength: 5000,

  async translate(text, from, to, _ctx, signal) {
    const token = await getToken(signal)
    const params = new URLSearchParams({ 'api-version': '3.0', to: toBingLang(to), textType: 'plain' })
    if (from !== 'auto') params.set('from', toBingLang(from))
    const res = await getFetch()(`${TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: text }]),
      signal,
    })
    if (!res.ok) throw httpError('bing', res)
    const data = (await res.json()) as unknown
    // 坑（OpenImmersive 2.3）：微软系端点会把业务错误裹在 HTTP 200 里返回对象而非数组
    // （如 {"statusCode":400,...}），必须校验形状再取字段。
    if (!Array.isArray(data)) {
      throw new Error('bing: business error hidden in HTTP 200 (non-array response)')
    }
    const item = data[0] as BingItem | undefined
    const translated = item?.translations?.[0]?.text
    if (typeof translated !== 'string') throw new Error('bing: unexpected response shape')
    const detectedLang = item?.detectedLanguage?.language
    return { text: translated, detectedLang }
  },
}
