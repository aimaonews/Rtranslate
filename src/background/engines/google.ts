import type { Engine, EngineResult } from './types'
import { getFetch, httpError } from './fetch'

/** Google gtx 免费端点：GET query 过长会被截断（~8k URL 上限，CJK 编码后 ≈9 字节/字），
 * 长文本改走同端点 POST form（响应形状一致）。见 interline mt.ts。 */
const GET_MAX_CHARS = 700
/** 编码后 query 仍超限的场景（大量 CJK/emoji/特殊字符），同样落 POST。 */
const GET_MAX_ENCODED_CHARS = 1800
/** 换行与控制字符在 query 里会被部分代理截断或 400 */
const GET_UNSAFE_RE = /[\r\n\x00-\x1f]/

function needsPost(text: string): boolean {
  return (
    text.length > GET_MAX_CHARS ||
    GET_UNSAFE_RE.test(text) ||
    encodeURIComponent(text).length > GET_MAX_ENCODED_CHARS
  )
}

/**
 * 响应形状：`[[[译文段, 原文段, ...], ...], ..., '检测语言码', ...]`。
 * 拼接 data[0] 每段首元素；data[2] 为检测出的源语言。
 */
export function parseGoogleSingle(data: unknown): EngineResult {
  if (!Array.isArray(data)) throw new Error('google: unexpected response shape')
  const segments = data[0]
  if (!Array.isArray(segments)) throw new Error('google: missing translation segments')
  const text = segments.map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : '')).join('').trim()
  const detectedLang = typeof data[2] === 'string' ? (data[2] as string) : undefined
  return { text, detectedLang }
}

export const googleEngine: Engine = {
  id: 'google',
  name: 'Google Translate (free)',
  kind: 'free',
  maxTextLength: 5000,

  async translate(text, from, to, _ctx, signal) {
    const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't' })
    const base = `https://translate.googleapis.com/translate_a/single?${params.toString()}`
    const init: RequestInit = needsPost(text)
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ q: text }).toString(),
        }
      : {}
    const url = init.method ? base : `${base}&${new URLSearchParams({ q: text }).toString()}`
    const res = await getFetch()(url, { ...init, signal })
    if (!res.ok) throw httpError('google', res)
    return parseGoogleSingle(await res.json())
  },
}
