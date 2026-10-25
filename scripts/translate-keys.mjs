// 用 aimao API 把 i18n-new-keys.json 的中文 UI 文案翻译成 8 语言
// 输出 scripts/i18n-translations.json: { lang: { key: translation } }
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ENDPOINT = 'https://api.aimao.today/v1/chat/completions'
const KEY = process.env.AIMAO_KEY ?? ''
if (!KEY) { console.error('请先设置环境变量 AIMAO_KEY'); process.exit(1) }
const MODEL = 'glm-5.3-flash'

const LANGS = {
  en: 'English',
  de: 'German (Deutsch)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  'pt-BR': 'Brazilian Portuguese (Português do Brasil)',
  ja: 'Japanese (日本語)',
  'zh-TW': 'Traditional Chinese (繁體中文, Taiwan)',
  ko: 'Korean (한국어)',
}

const keys = JSON.parse(readFileSync('scripts/i18n-new-keys.json', 'utf8'))
const entries = Object.entries(keys)
console.log('keys:', entries.length)

const CHUNK = 10
const out = {}
if (existsSync('scripts/i18n-translations.json')) {
  Object.assign(out, JSON.parse(readFileSync('scripts/i18n-translations.json', 'utf8')))
}

async function translateChunk(langName, pairs) {
  const obj = Object.fromEntries(pairs)
  const prompt = `You are a UI localization engine for a browser translation extension called Rtranslate (brand: aimao).
Translate the following UI strings from Simplified Chinese to ${langName}.

Rules:
- Return ONLY a JSON object with the SAME keys, values translated. No markdown, no commentary.
- Keep placeholders like {n}, {m}, {msg}, {exts}, {size}, {name} verbatim.
- Keep brand/product names untranslated: aimao, Rtranslate, OpenAI, DeepL, DeepSeek, Claude, Gemini, LibreTranslate, MyMemory, Google, Microsoft, YouTube, FSRS, API Key.
- Keep keyboard key names verbatim: Alt, Ctrl, Shift, Esc, Backspace, Delete, Enter, Space.
- Use standard software-UI terminology of the target language; keep labels short (button-length where the source is short).
- For Traditional Chinese (zh-TW), use Taiwan conventions.

JSON input:
${JSON.stringify(obj, null, 0)}`
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  })
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200))
  const j = await r.json()
  const text = j.choices?.[0]?.message?.content ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in response: ' + text.slice(0, 120))
  return JSON.parse(m[0])
}

const runLang = async ([lang, langName]) => {
  out[lang] = out[lang] || {}
  const missing = entries.filter(([k]) => !(k in out[lang]))
  if (missing.length === 0) {
    console.log(lang, 'already complete')
    return
  }
  console.log(lang, 'translating', missing.length, 'keys...')
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await translateChunk(langName, chunk)
        Object.assign(out[lang], res)
        process.stdout.write(`  ${lang} ${Math.min(i + CHUNK, missing.length)}/${missing.length}\r`)
        break
      } catch (e) {
        console.error(`  ${lang} chunk@${i} attempt${attempt + 1} failed:`, String(e).slice(0, 120))
        if (attempt === 2) throw e
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
  }
  writeFileSync('scripts/i18n-translations.json', JSON.stringify(out, null, 1))
  console.log(lang, 'done:', Object.keys(out[lang]).length)
}
await Promise.all(Object.entries(LANGS).map(runLang))
console.log('ALL TRANSLATIONS DONE')
