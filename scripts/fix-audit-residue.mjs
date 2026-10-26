// 修复审计发现的 2 处翻译缺陷：opt.s63（描述硬编码「译」）重述源文并重译；opt.s86（fr 嵌中文「收藏」）重译
import { readFileSync, writeFileSync } from 'node:fs'

const KEY = process.env.AIMAO_KEY
if (!KEY) { console.error('需要 AIMAO_KEY'); process.exit(1) }
const ROOT = 'C:/Users/Admin/Documents/浏览器翻译-kimi'

// 1) zh 源改为不硬编码「译」（预览字符随界面语言为 译/A）
{
  const p = ROOT + '/src/options/main.ts'
  const s = readFileSync(p, 'utf8')
  const old = "ot('opt.s63', '选择译文在页面中的展示样式；大号「译」字为实时预览。')"
  const neu = "ot('opt.s63', '选择译文在页面中的展示样式；大号预览字符为实时预览。')"
  if (!s.includes(old)) throw new Error('s63 source not found')
  writeFileSync(p, s.replace(old, neu))
  console.log('s63 zh source rephrased')
}

// 2) 重译两键 × 8 语言
const zh63 = '选择译文在页面中的展示样式；大号预览字符为实时预览。'
const zh86 = '浏览、导出或导入收藏的生词；数据仅保存在本机浏览器中。'
const LANGS = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', 'pt-BR': 'Brazilian Portuguese', ja: 'Japanese', 'zh-TW': 'Traditional Chinese (Taiwan)', ko: 'Korean' }
const out = {}
for (const [lang, l] of Object.entries(LANGS)) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch('https://api.aimao.today/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({
          model: 'glm-5.3-flash',
          messages: [{ role: 'user', content: 'Translate these UI strings from Simplified Chinese to ' + l + '. Return ONLY JSON with same keys. Standard software-UI terminology, keep it concise.\n' + JSON.stringify({ 'opt.s63': zh63, 'opt.s86': zh86 }) }],
          temperature: 0.2,
        }),
      })
      const j = await r.json()
      const m = (j.choices[0].message.content).match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(m[0])
      if (parsed['opt.s63'] === undefined || parsed['opt.s86'] === undefined) throw new Error('missing keys')
      out[lang] = parsed
      console.log(lang, '→', JSON.stringify(parsed))
      break
    } catch (e) {
      if (a === 2) throw e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
writeFileSync(ROOT + '/scripts/fix-s63-s86.json', JSON.stringify(out, null, 1))

// 3) 写入字典
const esc = (x) => x.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
function patch(src, vals, label) {
  let n = 0
  for (const [k, v] of Object.entries(vals)) {
    const kk = k.replace(/\./g, '\\.')
    const re = new RegExp("(^\\s*'" + kk + "': )(?:'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\")", 'm')
    if (!re.test(src)) { console.error('NOT FOUND', label, k); continue }
    src = src.replace(re, (_m, pre) => { n++; return pre + "'" + esc(v) + "'" })
  }
  console.log(label, 'patched', n)
  return src
}
{
  const p = ROOT + '/src/shared/i18n.ts'
  writeFileSync(p, patch(readFileSync(p, 'utf8'), out.en, 'EN'))
}
{
  const p = ROOT + '/src/shared/i18n-dicts.ts'
  let dicts = readFileSync(p, 'utf8')
  const names = { de: 'DICT_DE', es: 'DICT_ES', fr: 'DICT_FR', 'pt-BR': 'DICT_PT_BR', ja: 'DICT_JA', 'zh-TW': 'DICT_ZH_TW', ko: 'DICT_KO' }
  for (const [lang, dn] of Object.entries(names)) {
    const start = dicts.indexOf('export const ' + dn)
    const next = dicts.indexOf('export const ', start + 10)
    const end = next > 0 ? next : dicts.length
    dicts = dicts.slice(0, start) + patch(dicts.slice(start, end), out[lang], dn) + dicts.slice(end)
  }
  writeFileSync(p, dicts)
}
console.log('DONE')
