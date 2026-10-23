// 全界面截图：popup / options 10 标签 / review / files / 页面注入 UI
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
const OUT = new URL('./audit/', import.meta.url)
mkdirSync(OUT, { recursive: true })

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
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  return { c, targetId }
}
async function shot(c, name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(new URL(`./audit/${name}.png`, import.meta.url), Buffer.from(r.data, 'base64'))
  console.log(name + '.png')
}
async function evalIn(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.value
}

// 1. popup（以标签页形式打开）
{
  const { c, targetId } = await newTab(`${EXT}/popup.html`, 420, 640)
  await sleep(2000)
  await shot(c, '01-popup')
  await br.send('Target.closeTarget', { targetId })
}

// 2. options 全部标签
{
  const { c, targetId } = await newTab(`${EXT}/options.html`)
  await sleep(2200)
  const tabs = ['general', 'engine', 'experts', 'style', 'privacy', 'glossary', 'glossaryLibs', 'writing', 'words', 'interaction']
  for (const t of tabs) {
    await evalIn(c, `[...document.querySelectorAll('.nav-btn')].find(b => b.dataset.tab === '${t}')?.click(), true`)
    await sleep(700)
    await shot(c, `02-options-${t}`)
  }
  await br.send('Target.closeTarget', { targetId })
}

// 3. review 空态
{
  const { c, targetId } = await newTab(`${EXT}/review.html`)
  await sleep(2000)
  await shot(c, '03-review')
  await br.send('Target.closeTarget', { targetId })
}

// 4. files 初始态
{
  const { c, targetId } = await newTab(`${EXT}/files.html`)
  await sleep(2000)
  await shot(c, '04-files')
  await br.send('Target.closeTarget', { targetId })
}

// 5. 测试页：整页翻译 + 悬浮球 + 划词气泡
{
  const { c, targetId } = await newTab('http://127.0.0.1:8137/test-page.html')
  await sleep(3500)
  // 通过 SW 切换整页翻译
  const t = await br.send('Target.getTargets')
  const sw = t.targetInfos.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
  if (sw) {
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
  }
  await sleep(14000)
  await shot(c, '05-page-translated')
  // 划词气泡
  await evalIn(c, `(async () => {
    const p = document.querySelectorAll('p')[1];
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise(r => setTimeout(r, 5000));
    return true;
  })()`)
  await shot(c, '06-selection-popup')
  await br.send('Target.closeTarget', { targetId })
}
console.log('done')
process.exit(0)
