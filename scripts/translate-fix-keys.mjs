// 重译受模板字面量损伤的键（{pN} 占位符形式）
import { readFileSync, writeFileSync } from 'node:fs'

const ENDPOINT = 'https://api.aimao.today/v1/chat/completions'
const KEY = process.env.AIMAO_KEY
if (!KEY) { console.error('请先设置环境变量 AIMAO_KEY'); process.exit(1) }
const MODEL = 'glm-5.3-flash'

const LANGS = {
  en: 'English', de: 'German (Deutsch)', es: 'Spanish (Español)', fr: 'French (Français)',
  'pt-BR': 'Brazilian Portuguese (Português do Brasil)', ja: 'Japanese (日本語)',
  'zh-TW': 'Traditional Chinese (繁體中文, Taiwan)', ko: 'Korean (한국어)',
}

const keys = JSON.parse(readFileSync('scripts/i18n-fix-keys.json', 'utf8'))
const entries = Object.entries(keys)
console.log('keys:', entries.length)

async function translateChunk(langName, pairs) {
  const obj = Object.fromEntries(pairs)
  const prompt = `You are a UI localization engine for a browser translation extension called Rtranslate.
Translate the following UI strings from Simplified Chinese to ${langName}.

Rules:
- Return ONLY a JSON object with the SAME keys. No markdown, no commentary.
- Placeholders like {p1}, {p2}, {n} MUST be preserved verbatim in the output at the semantically appropriate position for ${langName} (they will be replaced by values at runtime).
- Keep brand names untranslated: aimao, Rtranslate, OpenAI, DeepL, DeepSeek, Claude, Gemini, LibreTranslate, MyMemory, Google, Microsoft, FSRS, API Key.
- Standard software-UI terminology; keep short strings short.

JSON input:
${JSON.stringify(obj, null, 0)}`
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const j = await r.json()
  const text = j.choices?.[0]?.message?.content ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON: ' + text.slice(0, 100))
  return JSON.parse(m[0])
}

const out = {}
for (const [lang, langName] of Object.entries(LANGS)) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await translateChunk(langName, entries)
      // 校验占位符
      let bad = 0
      for (const [k, zh] of entries) {
        const zhPh = (zh.match(/\{p\d+\}/g) || []).sort().join(',')
        const vPh = (String(res[k] ?? '').match(/\{p\d+\}/g) || []).sort().join(',')
        if (zhPh !== vPh) { console.error(`  PLACEHOLDER ${lang}.${k}: "${res[k]}"`); bad++ }
      }
      if (bad) throw new Error(bad + ' placeholder mismatches')
      out[lang] = res
      console.log(lang, 'ok')
      break
    } catch (e) {
      console.error(lang, 'attempt', attempt + 1, String(e).slice(0, 100))
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
writeFileSync('scripts/i18n-translations-fix.json', JSON.stringify(out, null, 1))
console.log('FIX TRANSLATIONS DONE')
