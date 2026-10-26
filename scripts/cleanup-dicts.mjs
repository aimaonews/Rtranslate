// 修复 1+2：从 i18n.ts EN 块与 i18n-dicts.ts 7 字典中删除
//   a) 全部 pages 命名空间键（files./onboarding./review. —— 归 i18n-pages.ts 管）
//   b) 14 个从未接线的 engine.* 死键
// 删除前校验：pages 键必须存在于 i18n-pages（EN 块），否则中止。
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'C:/Users/Admin/Documents/浏览器翻译-kimi'
const enTs = readFileSync(ROOT + '/src/shared/i18n.ts', 'utf8')
const dicts = readFileSync(ROOT + '/src/shared/i18n-dicts.ts', 'utf8')
const pages = readFileSync(ROOT + '/src/shared/i18n-pages.ts', 'utf8')

const chr39 = String.fromCharCode(39)
const pagesEnBlock = pages.slice(pages.indexOf('const EN'), pages.indexOf('const DE'))
const enBlock = enTs.slice(enTs.indexOf('const EN'))

// 收集要删的键
const nsRe = /^  '((?:files|onboarding|review)\.[\w.]+)': /gm
const remove = new Set()
for (const m of enBlock.matchAll(nsRe)) {
  // 只删与 i18n-pages 重复的语义键；转换器生成的 files.sNN（pages 无对应）保留
  if (pagesEnBlock.includes(chr39 + m[1] + chr39 + ':')) remove.add(m[1])
}
const DEAD_ENGINE = [
  'engine.endpoint', 'engine.model', 'engine.timeout', 'engine.connectivity',
  'engine.testConnection', 'engine.testing', 'engine.connected', 'engine.testFailed',
  'engine.show', 'engine.hide', 'engine.none', 'engine.add', 'engine.remove', 'engine.empty',
]
for (const k of DEAD_ENGINE) remove.add(k)

// 校验 pages 键在 i18n-pages 中存在
const missing = [...remove].filter((k) => k.startsWith('files.') || k.startsWith('onboarding.') || k.startsWith('review.'))
  .filter((k) => !pagesEnBlock.includes("'" + k + "':"))
if (missing.length) throw new Error('pages 字典缺失，不能删: ' + missing.join(', '))
console.log('待删除键:', remove.size, '（pages 命名空间', remove.size - DEAD_ENGINE.length, '+ 死 engine', DEAD_ENGINE.length, '）')

// 行级删除：每键一行（合并重建后的格式保证）
function removeLines(src, keys, label) {
  const lines = src.split('\n')
  const keySet = new Set(keys)
  let removed = 0
  const out = lines.filter((l) => {
    const m = l.match(/^  '([\w.]+)': /)
    if (m && keySet.has(m[1])) { removed++; return false }
    return true
  })
  console.log(label, '删除行:', removed)
  return out.join('\n')
}

const newEn = removeLines(enTs, remove, 'i18n.ts EN')
const newDicts = removeLines(dicts, remove, 'i18n-dicts.ts')
writeFileSync(ROOT + '/src/shared/i18n.ts', newEn)
writeFileSync(ROOT + '/src/shared/i18n-dicts.ts', newDicts)

// 复验：键集合一致 + 计数
function countKeys(src, marker) {
  const ks = src.indexOf(marker)
  const ke = src.indexOf('\n}', ks)
  return (src.slice(ks, ke).match(/^  '[\w.]+': /gm) || []).length
}
const enCount = countKeys(newEn, 'const EN')
console.log('EN 键数: 565 →', enCount)
const names = ['DICT_DE', 'DICT_ES', 'DICT_FR', 'DICT_PT_BR', 'DICT_JA', 'DICT_ZH_TW', 'DICT_KO']
for (const d of names) {
  const c = countKeys(newDicts, 'export const ' + d)
  if (c !== enCount) throw new Error(d + ' 键数 ' + c + ' ≠ EN ' + enCount)
}
console.log('7 字典键数全部 =', enCount, '✓')
console.log('CLEANUP DONE')
