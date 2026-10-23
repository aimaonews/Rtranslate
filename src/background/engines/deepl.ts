import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

/**
 * DeepL 语言码：zh-* 统一 ZH（DeepL 不区分简繁，繁体由目标文本自身决定）、
 * en→EN-US、其余大写主码（fr→FR）。
 */
export function toDeepLLang(code: string): string {
  const c = code.trim().toLowerCase()
  if (c === 'zh' || c.startsWith('zh-') || c.startsWith('zh_')) return 'ZH'
  if (c === 'en' || c.startsWith('en-')) return 'EN-US'
  return c.split('-')[0].toUpperCase()
}

interface DeepLResponse {
  translations?: Array<{ text?: string; detected_source_language?: string }>
}

export const deeplEngine: Engine = {
  id: 'deepl',
  name: 'DeepL',
  kind: 'byok',
  requiresKey: true,
  maxTextLength: 5000,

  async translate(text, from, to, ctx, signal) {
    const key = ctx.config.engine.keys.deepl
    if (!key) {
      throw new Error("deepl: missing API key. Open the Rtranslate options page to set it.")
    }
    // 契约固定 api-free 端点（§5 keys 只有一格，不区分 free/pro；pro key 需 api.deepl.com）
    const res = await getFetch()('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: toDeepLLang(to),
        // source_lang 省略即自动检测；'auto' 不是合法值，必须整键省略
        ...(from !== 'auto' ? { source_lang: toDeepLLang(from) } : {}),
      }),
      signal,
    })
    if (!res.ok) throw httpError('deepl', res)
    const data = (await res.json()) as DeepLResponse
    const tr = data.translations?.[0]
    if (typeof tr?.text !== 'string') throw new Error('deepl: unexpected response shape')
    return { text: tr.text, detectedLang: tr.detected_source_language }
  },
}
