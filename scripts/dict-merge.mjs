// 合并：远端完好字典（含 tab.*/tabDesc.*）+ 本次重建的新键
// parse 支持一行多键（历史插入格式）
import { readFileSync, writeFileSync } from 'node:fs'

function parse(src, marker) {
  const out = {}
  const ks = src.indexOf(marker)
  const ke = src.indexOf('\n}', ks)
  const re = /'([a-zA-Z][\w.]*)': (?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
  for (const m of src.slice(ks, ke).matchAll(re)) {
    const raw = m[2] !== undefined ? m[2] : m[3]
    out[m[1]] = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return out
}
function build(map) {
  return Object.entries(map)
    .map(([k, v]) => `  '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    .join('\n')
}

const remoteDicts = readFileSync('scripts/remote-i18n-dicts.ts', 'utf8')
const remoteEN = readFileSync('scripts/remote-i18n.ts', 'utf8')
const curEN = readFileSync('src/shared/i18n.ts', 'utf8')

const remEN = parse(remoteEN, 'const EN')
const curENMap = parse(curEN, 'const EN')
const newKeys = Object.keys(curENMap).filter((k) => !(k in remEN))
console.log('remote EN:', Object.keys(remEN).length, '| current EN:', Object.keys(curENMap).length, '| new-only:', newKeys.length, newKeys.slice(0, 10))

const mergedEN = { ...remEN }
for (const k of newKeys) mergedEN[k] = curENMap[k]

const dictNames = { DICT_DE: 'de', DICT_ES: 'es', DICT_FR: 'fr', DICT_PT_BR: 'pt-BR', DICT_JA: 'ja', DICT_ZH_TW: 'zh-TW', DICT_KO: 'ko' }
const merged = {}
for (const [d, lang] of Object.entries(dictNames)) {
  const rem = parse(remoteDicts, 'export const ' + d)
  const cur = parse(readFileSync('src/shared/i18n-dicts.ts', 'utf8'), 'export const ' + d)
  const m = { ...rem }
  let added = 0
  for (const k of newKeys) {
    if (cur[k] !== undefined) { m[k] = cur[k]; added++ }
  }
  merged[lang] = m
  console.log(d, 'remote:', Object.keys(rem).length, '+ new:', added)
}

const refKeys = Object.keys(mergedEN).sort()
for (const [lang, m] of Object.entries(merged)) {
  const diff = refKeys.filter((k) => !(k in m)).concat(Object.keys(m).filter((k) => !(k in mergedEN)))
  if (diff.length) throw new Error(lang + ' key mismatch: ' + diff.slice(0, 8))
}
console.log('all key sets consistent:', refKeys.length)

// EN 块
{
  const p = 'src/shared/i18n.ts'
  let s = readFileSync(p, 'utf8')
  const a = s.indexOf('const EN: Record<string, string> = {')
  const b = s.indexOf('\n}', a)
  s = s.slice(0, a) + 'const EN: Record<string, string> = {\n' + build(mergedEN) + s.slice(b)
  writeFileSync(p, s)
  console.log('i18n.ts EN written:', refKeys.length)
}
// 7 dicts 全文件
{
  let dicts = "import { registerDict } from './i18n'\n"
  dicts += '/**\n * 通用界面字典（7 语言）：options/popup/content 共用；键集合与 i18n.ts 的 EN 完全一致。\n * 词条：远端校验版 + 新增键（aimao API 翻译，脚本见 scripts/）。\n */\n'
  for (const d of Object.keys(dictNames)) {
    dicts += `\nexport const ${d}: Record<string, string> = {\n${build(merged[dictNames[d]])}\n}\n`
  }
  dicts += '\n' + Object.keys(dictNames).map((d) => `registerDict('${dictNames[d]}', ${d})`).join('\n') + '\n'
  writeFileSync('src/shared/i18n-dicts.ts', dicts)
  console.log('i18n-dicts.ts written')
}
console.log('MERGE DONE')
