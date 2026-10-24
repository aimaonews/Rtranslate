// 9 语言商店截图批量运行器：
//   每语言：优雅重启 Edge（防 CDP 截图挂起）→ Extensions.loadUnpacked 重载扩展
//   → node shot-one-lang.mjs <uiLang> <targetLang> <dir> <page>
// 用法：node shot-all-langs.mjs [langKey ...]   （缺省全部 9 种）
// 前置：8137 测试页服务已运行
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PROFILE = ROOT.replaceAll('\\', '/') + '/scripts/e2e/profile'
const DIST = ROOT.replaceAll('\\', '/') + '/dist'
const CDP = 'http://127.0.0.1:9222'

// dir（输出目录名）→ { uiLang, targetLang, page }
const LANGS = {
  ja: { uiLang: 'ja', targetLang: 'ja', page: 'test-page-shot.html' },
  ko: { ko: 'ko', targetLang: 'ko', page: 'test-page-shot.html', uiLang: 'ko' },
  zh_CN: { uiLang: 'zh-CN', targetLang: 'zh-CN', page: 'test-page-shot.html' },
  zh_TW: { uiLang: 'zh-TW', targetLang: 'zh-TW', page: 'test-page-shot.html' },
  de: { uiLang: 'de', targetLang: 'de', page: 'test-page-shot.html' },
  es: { uiLang: 'es', targetLang: 'es', page: 'test-page-shot.html' },
  fr: { uiLang: 'fr', targetLang: 'fr', page: 'test-page-shot.html' },
  pt_BR: { uiLang: 'pt-BR', targetLang: 'pt', page: 'test-page-shot.html' },
  en: { uiLang: 'en', targetLang: 'en', page: 'test-page-zh.html' }, // 英文商店：中文原文 → 英文译文
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpVersion() {
  const r = await fetch(CDP + '/json/version')
  if (!r.ok) throw new Error('CDP not ready: ' + r.status)
  return r.json()
}

async function browserWs() {
  const v = await cdpVersion()
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
      }
    }
    ws.onopen = () => resolve({ send, close: () => ws.close() })
    ws.onerror = reject
  })
}

async function closeEdge() {
  try {
    const br = await browserWs()
    await br.send('Browser.close').catch(() => {})
    br.close()
  } catch {
    // CDP 不可达则直接杀进程
    try { await execFileP('taskkill', ['/IM', 'msedge.exe', '/F']) } catch {}
  }
  await sleep(5000) // 等配置文件解锁
}

async function launchEdge(startUrl) {
  spawn(EDGE, [
    '--remote-debugging-port=9222',
    '--remote-allow-origins=*',
    '--enable-unsafe-extensions-debugging',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    startUrl,
  ], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try { await cdpVersion(); return } catch {}
  }
  throw new Error('Edge did not start with CDP')
}

async function loadExtension() {
  const br = await browserWs()
  try {
    const r = await br.send('Extensions.loadUnpacked', { path: DIST })
    console.log('  extension loaded:', r.id)
  } finally {
    br.close()
  }
}

async function runOne(key) {
  const { uiLang, targetLang, page } = LANGS[key]
  console.log(`\n===== [${key}] uiLang=${uiLang} targetLang=${targetLang} page=${page} =====`)
  await closeEdge()
  await launchEdge('http://127.0.0.1:8137/' + page)
  await sleep(3000)
  await loadExtension()
  await sleep(2000)

  const shot = spawn(process.execPath, [join(HERE, 'shot-one-lang.mjs'), uiLang, targetLang, key, page], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  shot.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
  shot.stderr.on('data', (d) => { out += d; process.stderr.write(d) })
  const code = await new Promise((r) => shot.on('close', r))
  return { key, ok: code === 0, code, tail: out.split('\n').slice(-4).join('\n') }
}

const args = process.argv.slice(2)
const keys = args.length ? args : Object.keys(LANGS)
const results = []
for (const key of keys) {
  try {
    results.push(await runOne(key))
  } catch (e) {
    results.push({ key, ok: false, code: -1, tail: String(e) })
  }
}
// 收尾：关掉 Edge
await closeEdge().catch(() => {})

console.log('\n===== SUMMARY =====')
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.key}${r.ok ? '' : '\n  ' + r.tail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} languages succeeded`)
process.exit(failed.length ? 1 : 0)
