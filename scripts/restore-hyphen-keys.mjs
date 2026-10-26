// 修复：恢复被连字符正则丢弃的键
// 1. 用修正正则([\w.-]*)解析远端(755ad4069c)的 EN + 7 字典
// 2. 找出当前字典缺失的全部键（不止 style.*，可能有其他连字符键）
// 3. 从远端恢复到当前 i18n.ts / i18n-dicts.ts
import { readFileSync, writeFileSync } from 'node:fs'

const PAT = process.env.GH_PAT
if (!PAT) { console.error('请先设置环境变量 GH_PAT'); process.exit(1) }
const ROOT = 'C:/Users/Admin/Documents/浏览器翻译-kimi'

async function fetchFile(ref, path) {
  const r = await fetch('https://api.github.com/repos/aimaonews/Rtranslate/contents/' + path.replace(/\//g, '%2F') + '?ref=' + ref, {
    headers: { Authorization: 'Bearer ' + PAT, Accept: 'application/vnd.github+json' },
  })
  const j = await r.json()
  return Buffer.from(j.content, 'base64').toString('utf8')
}

// 修正版解析：键字符类加连字符
function parse(src, marker) {
  const out = {}
  const ks = src.indexOf(marker)
  const ke = src.indexOf('\n}', ks)
  const re = /'([a-zA-Z][\w.-]*)': (?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
  for (const m of src.slice(ks, ke).matchAll(re)) {
    out[m[1]] = (m[2] !== undefined ? m[2] : m[3]).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }
  return out
}

const remoteEn = await fetchFile('755ad4069c', 'src/shared/i18n.ts')
const remoteDicts = await fetchFile('755ad4069c', 'src/shared/i18n-dicts.ts')
const remEN = parse(remoteEn, 'const EN')
console.log('远端 EN（修正正则）键数:', Object.keys(remEN).length)

const curEn = readFileSync(ROOT + '/src/shared/i18n.ts', 'utf8')
const curDicts = readFileSync(ROOT + '/src/shared/i18n-dicts.ts', 'utf8')
const curEN = parse(curEn, 'const EN')

// 当前缺失的键（远端有、当前无）——排除故意删除的 90 键
const INTENTIONALLY_REMOVED = readFileSync(ROOT + '/scripts/cleanup-dicts.mjs', 'utf8')
const lost = Object.keys(remEN).filter((k) => !(k in curEN))
console.log('远端有而当前缺失的键:', lost.length, lost)

// 恢复：EN
{
  const lines = lost.map((k) => `  '${k}': '${remEN[k].replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
  const a = curEn.indexOf('const EN: Record<string, string> = {')
  const insertAt = curEn.indexOf('\n', a) + 1
  const next = curEn.slice(0, insertAt) + lines.join('\n') + '\n' + curEn.slice(insertAt)
  writeFileSync(ROOT + '/src/shared/i18n.ts', next)
  console.log('EN 恢复', lost.length, '键')
}
// 恢复：7 字典
{
  const names = { DICT_DE: 'de', DICT_ES: 'es', DICT_FR: 'fr', DICT_PT_BR: 'pt-BR', DICT_JA: 'ja', DICT_ZH_TW: 'zh-TW', DICT_KO: 'ko' }
  let src = curDicts
  for (const [d, lang] of Object.entries(names)) {
    const rem = parse(remoteDicts, 'export const ' + d)
    const start = src.indexOf('export const ' + d)
    if (start < 0) throw new Error(d)
    const insertAt = src.indexOf('\n', start) + 1
    const lines = lost.map((k) => `  '${k}': '${String(rem[k]).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    src = src.slice(0, insertAt) + lines.join('\n') + '\n' + src.slice(insertAt)
    console.log(d, '恢复', lost.length, '键')
  }
  writeFileSync(ROOT + '/src/shared/i18n-dicts.ts', src)
}

// 复验：键集合一致 + style.* 全部在位
{
  const en2 = readFileSync(ROOT + '/src/shared/i18n.ts', 'utf8')
  const dicts2 = readFileSync(ROOT + '/src/shared/i18n-dicts.ts', 'utf8')
  const enKeys = Object.keys(parse(en2, 'const EN')).sort()
  for (const d of Object.keys({ DICT_DE: 1, DICT_ES: 1, DICT_FR: 1, DICT_PT_BR: 1, DICT_JA: 1, DICT_ZH_TW: 1, DICT_KO: 1 })) {
    const dk = Object.keys(parse(dicts2, 'export const ' + d)).sort()
    if (dk.join() !== enKeys.join()) throw new Error(d + ' 键集合不一致')
  }
  console.log('9 字典键集合一致:', enKeys.length)
  for (const s of ['soft-gray', 'underline-dotted', 'highlight-yellow', 'highlight-green', 'blur-mask']) {
    if (!enKeys.includes('style.' + s)) throw new Error('style.' + s + ' 仍缺失')
  }
  console.log('5 个连字符样式键全部在位 ✓')
}
console.log('RESTORE DONE')
