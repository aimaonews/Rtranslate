import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

/** LibreTranslate 用主码（zh-CN→zh）；'auto' 直通（服务端支持自动检测）。 */
function stripRegion(code: string): string {
  return code === 'auto' ? 'auto' : code.split('-')[0]
}

export const libreEngine: Engine = {
  id: 'libretranslate',
  name: 'LibreTranslate',
  // 公共实例免 key，但自托管 URL 即"配置"，故归 byok 一侧且不进免费链（requiresKey=false）
  kind: 'byok',
  requiresKey: false,
  maxTextLength: 5000,

  async translate(text, from, to, ctx, signal) {
    // keys.libreUrl 可指向自托管实例；空则用公共实例。去尾斜杠防 ...//translate
    const base = (ctx.config.engine.keys.libreUrl || 'https://libretranslate.com').replace(/\/+$/, '')
    const res = await getFetch()(`${base}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: stripRegion(from),
        target: stripRegion(to),
        format: 'text',
      }),
      signal,
    })
    if (!res.ok) throw httpError('libretranslate', res)
    const data = (await res.json()) as { translatedText?: unknown }
    if (typeof data.translatedText !== 'string') {
      throw new Error('libretranslate: unexpected response shape')
    }
    return { text: data.translatedText }
  },
}
