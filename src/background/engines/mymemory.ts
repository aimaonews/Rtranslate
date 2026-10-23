import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

const API_URL = 'https://api.mymemory.translated.net/get'
/** 免费匿名档硬上限：超出截断而非报错（OpenImmersive 2.2 的做法），长文本由管线切块。 */
export const MYMEMORY_MAX_CHARS = 500

interface MyMemoryResponse {
  responseStatus?: number
  responseMessage?: string
  responseData?: { translatedText?: string }
}

export const mymemoryEngine: Engine = {
  id: 'mymemory',
  name: 'MyMemory (free)',
  kind: 'free',
  maxTextLength: MYMEMORY_MAX_CHARS,

  async translate(text, from, to, _ctx, signal) {
    // MyMemory 不认 'auto'（langpair 必须双码），兜底 'en'——它只影响 TM 匹配倾向
    const sl = from === 'auto' ? 'en' : from
    const q = text.length > MYMEMORY_MAX_CHARS ? text.slice(0, MYMEMORY_MAX_CHARS) : text
    const params = new URLSearchParams({ q, langpair: `${sl}|${to}` })
    const res = await getFetch()(`${API_URL}?${params.toString()}`, { signal })
    if (!res.ok) throw httpError('mymemory', res)
    const data = (await res.json()) as MyMemoryResponse
    // 坑：MyMemory 限流/无效 langpair 也是 HTTP 200，业务状态在 responseStatus 里
    if (data.responseStatus !== 200) {
      throw new Error(`mymemory: ${data.responseMessage ?? `responseStatus ${data.responseStatus}`}`)
    }
    const translated = data.responseData?.translatedText
    if (typeof translated !== 'string') throw new Error('mymemory: unexpected response shape')
    return { text: translated }
  },
}
