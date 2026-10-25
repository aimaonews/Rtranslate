// 把 scripts/i18n-translations.json 写进 i18n.ts(EN) 与 i18n-dicts.ts(7 语言)
// 用法：node scripts/write-translations.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const keys = JSON.parse(readFileSync('scripts/i18n-new-keys.json', 'utf8'))
const tr = JSON.parse(readFileSync('scripts/i18n-translations.json', 'utf8'))

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// 校验：每语言键数齐全、占位符保留
const PLACEHOLDER = /\{(\w+)\}/g
let problems = 0
for (const lang of Object.keys(tr)) {
  for (const [key, zh] of Object.entries(keys)) {
    const v = tr[lang][key]
    if (v === undefined) {
      console.error(`MISSING ${lang}.${key}`)
      problems++
      continue
    }
    const zhPh = [...zh.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',')
    const vPh = [...String(v).matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',')
    if (zhPh !== vPh) {
      console.error(`PLACEHOLDER ${lang}.${key}: zh{${zhPh}} vs ${lang}{${vPh}}`)
      problems++
    }
  }
}
console.log('placeholder/missing problems:', problems)

// EN → i18n.ts
{
  const p = 'src/shared/i18n.ts'
  let s = readFileSync(p, 'utf8')
  const anchor = "  'engine.empty': 'Empty',"
  if (!s.includes(anchor)) throw new Error('EN anchor missing')
  const lines = Object.entries(keys)
    .map(([k]) => `  '${k}': '${esc(String(tr.en[k] ?? keys[k]))}',`)
    .join('\n')
  if (!s.includes("'opt.s1'")) {
    s = s.replace(anchor, anchor + '\n  // 全量 UI 文案（options/popup/files/onboarding，由 scripts/translate-keys.mjs 生成）\n' + lines)
    writeFileSync(p, s)
    console.log('i18n.ts EN +%d', Object.keys(keys).length)
  } else {
    console.log('i18n.ts already has opt.s1, skip')
  }
}

// 7 语言 → i18n-dicts.ts
{
  const p = 'src/shared/i18n-dicts.ts'
  let s = readFileSync(p, 'utf8')
  const dicts = { DICT_DE: 'de', DICT_ES: 'es', DICT_FR: 'fr', DICT_PT_BR: 'pt-BR', DICT_JA: 'ja', DICT_ZH_TW: 'zh-TW', DICT_KO: 'ko' }
  for (const [dictName, lang] of Object.entries(dicts)) {
    const start = s.indexOf('export const ' + dictName)
    if (start < 0) throw new Error(dictName)
    const anchorPos = s.indexOf("'engine.empty':", start)
    if (anchorPos < 0) throw new Error(dictName + ' anchor')
    const lineEnd = s.indexOf('\n', anchorPos)
    if (s.includes("'opt.s1'", start)) {
      console.log(dictName, 'already has opt.s1, skip')
      continue
    }
    const lines = Object.entries(keys)
      .map(([k]) => `  '${k}': '${esc(String(tr[lang][k] ?? keys[k]))}',`)
      .join('\n')
    s = s.slice(0, lineEnd + 1) + '  // 全量 UI 文案\n' + lines + '\n' + s.slice(lineEnd + 1)
    console.log(dictName, '+%d', Object.keys(keys).length)
  }
  writeFileSync(p, s)
}
console.log('DICTS WRITTEN')
