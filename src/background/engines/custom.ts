import type { Engine } from './types'
import { getFetch, httpError } from './fetch'

/** 模板占位渲染：{{text}}/{{from}}/{{to}}（容忍空格）。转义交给 JSON.stringify——
 * bodyJson 是 JSON 模板，占位符在字符串字面量内，原文含引号/换行时直接 replace 会产出非法 JSON，
 * 因此对 {{text}} 做 JSON 字符串内联转义后再替换。 */
export function renderBodyTemplate(template: string, vars: { text: string; from: string; to: string }): string {
  const escaped = {
    // JSON.stringify 带首尾引号，切片去掉——模板里占位符已处在引号内
    text: JSON.stringify(vars.text).slice(1, -1),
    from: JSON.stringify(vars.from).slice(1, -1),
    to: JSON.stringify(vars.to).slice(1, -1),
  }
  return template
    .replace(/\{\{\s*text\s*\}\}/g, escaped.text)
    .replace(/\{\{\s*from\s*\}\}/g, escaped.from)
    .replace(/\{\{\s*to\s*\}\}/g, escaped.to)
}

/** 响应兼容三种形态 {text} / {translation} / {data:{text}}：递归找第一个字符串字段。 */
export function extractFirstString(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = extractFirstString(item)
      if (hit !== null) return hit
    }
    return null
  }
  if (typeof data === 'object' && data !== null) {
    // 优先常见键，再全键扫描
    const obj = data as Record<string, unknown>
    for (const key of ['text', 'translation', 'translatedText', 'result']) {
      const hit = extractFirstString(obj[key])
      if (hit !== null) return hit
    }
    for (const key of Object.keys(obj)) {
      const hit = extractFirstString(obj[key])
      if (hit !== null) return hit
    }
  }
  return null
}

export const customEngine: Engine = {
  id: 'custom',
  name: 'Custom JSON API',
  kind: 'byok',
  // url 而非 key 是必需配置；requiresKey=false，缺 url 的错误在调用时抛出
  requiresKey: false,
  maxTextLength: 5000,

  async translate(text, from, to, ctx, signal) {
    const url = ctx.config.engine.custom.url.trim()
    if (!url) {
      throw new Error('custom: missing endpoint URL. Open the Rtranslate options page to configure it.')
    }
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const headersJson = ctx.config.engine.keys.customHeadersJson.trim()
    if (headersJson) {
      let parsed: unknown
      try {
        parsed = JSON.parse(headersJson)
      } catch (e) {
        throw new Error(`custom: customHeadersJson is not valid JSON: ${(e as Error).message}`)
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('custom: customHeadersJson must be a JSON object of header name to value')
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k] = v
      }
    }
    const body = renderBodyTemplate(ctx.config.engine.custom.bodyJson, { text, from, to })
    const res = await getFetch()(url, { method: 'POST', headers, body, signal })
    if (!res.ok) throw httpError('custom', res)
    const data = (await res.json()) as unknown
    const translated = extractFirstString(data)
    if (translated === null) throw new Error('custom: no string field found in response')
    return { text: translated }
  },
}
