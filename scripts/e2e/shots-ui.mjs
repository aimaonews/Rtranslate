// UI 截图验证：options 页 / 整页翻译（蓝色悬浮球）/ 划词气泡
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9222'
const PAGE_URL = 'http://127.0.0.1:8137/test-page.html'

function mk(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    const send = (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const mid = ++id
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify(sessionId ? { id: mid, method, params, sessionId } : { id: mid, method, params }))
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)

async function newTab(url) {
  const { targetId } = await br.send('Target.createTarget', { url })
  let info = null
  for (let i = 0; i < 20; i++) {
    await sleep(400)
    const list = await (await fetch(CDP + '/json/list')).json()
    info = list.find((x) => x.id === targetId)
    if (info) break
  }
  if (!info) throw new Error('new tab not listed: ' + url)
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  return c
}
async function shot(c, name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(new URL(`./shot-${name}.png`, import.meta.url), Buffer.from(r.data, 'base64'))
  console.log(`shot-${name}.png saved`)
}
async function evalIn(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}

// 1. 设置页
const opt = await newTab('chrome-extension://obommjidieecapideeemdlcegndcdnkd/options.html')
await sleep(2500)
await shot(opt, 'options')

// 2. 测试页 + 整页翻译 + 悬浮球
const pg = await newTab(PAGE_URL)
await sleep(3500)
await evalIn(pg, `(async () => {
  const cur = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'] ?? {};
  await chrome.storage.local.set({ 'tv:config_v1': { ...cur, engine: { ...(cur.engine ?? {}), provider: 'mymemory', timeoutMs: 8000 } } });
  return true;
})()`).catch(() => {}) // 主世界无 chrome.runtime，失败则跳过（默认 google 链也能降级）
// 通过 SW 切换翻译
const t = await br.send('Target.getTargets')
const sw = t.targetInfos.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
const { sessionId } = await br.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
await br.send('Runtime.enable', {}, sessionId)
await br.send('Runtime.evaluate', {
  expression: `(async () => {
    const cur = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'] ?? {};
    await chrome.storage.local.set({ 'tv:config_v1': { ...cur, engine: { ...(cur.engine ?? {}), provider: 'mymemory', timeoutMs: 8000 } } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' });
    return true;
  })()`,
  awaitPromise: true, returnByValue: true,
}, sessionId)
await sleep(15000)
await shot(pg, 'page-translated')

// 3. 划词气泡
await evalIn(pg, `(async () => {
  const p = document.querySelectorAll('p')[1];
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await new Promise(r => setTimeout(r, 6000));
  return true;
})()`)
await shot(pg, 'selection-popup')

// 4. 复习页
const rv = await newTab('chrome-extension://obommjidieecapideeemdlcegndcdnkd/review.html')
await sleep(2500)
await shot(rv, 'review')
console.log('done')
process.exit(0)
