// 单语言商店截图（真实渲染，非合成）：
//   1. 关闭所有扩展页标签（防 onboarding/options 陈旧配置回写覆盖注入值）
//   2. 在 Service Worker 上下文注入配置：AI猫引擎 + uiLang + targetLang
//   3. chrome.tabs.sendMessage 触发整页翻译，轮询至译文稳定且零错误
//   4. 截图×3：双语整页 / 划词气泡 / 设置页（目标界面语言）
// 用法：node shot-one-lang.mjs <uiLang> <targetLang> <outDir> [pagePath]
//   例：node shot-one-lang.mjs ja ja ja test-page-shot.html
// 前置：Edge 已带 --remote-debugging-port=9222 启动、扩展已加载、8137 服务已运行
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'store-assets', 'screenshots')

const AIMAO_KEY = 'sk-f0e72732f7e734de2747c7e0cfc0c295822c00096756ccbc28e1675a987467a9'
const AIMAO_MODEL = 'glm-5.3-flash'

const [uiLang, targetLang, dirName, pagePath = 'test-page-shot.html'] = process.argv.slice(2)
if (!uiLang || !targetLang || !dirName) {
  console.error('Usage: node shot-one-lang.mjs <uiLang> <targetLang> <outDir> [pagePath]')
  process.exit(1)
}
const PAGE = 'http://127.0.0.1:8137/' + pagePath

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

// ---- 1. 关闭所有扩展页（onboarding/options 等持有陈旧 config 的页面）----
{
  const t = await br.send('Target.getTargets')
  for (const ti of t.targetInfos) {
    if (ti.type === 'page' && ti.url.startsWith(EXT)) {
      await br.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {})
      console.log('closed ext page:', ti.url.split('/').pop())
    }
  }
}

// ---- 2. SW 会话（必要时用后台扩展页唤醒）----
async function findSW() {
  const t = await br.send('Target.getTargets')
  return t.targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(EXT)) || null
}
async function ensureSWSession() {
  let sw = await findSW()
  if (!sw) {
    // 前台开一个扩展页（后台标签会被 Edge 懒加载，不会真正执行）；
    // popup 加载即向 SW 发 getConfig，从而唤醒 SW
    const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/popup.html` })
    for (let i = 0; i < 20 && !sw; i++) {
      await sleep(500)
      sw = await findSW()
    }
    await br.send('Target.closeTarget', { targetId }).catch(() => {})
  }
  if (!sw) throw new Error('service worker not reachable')
  const { sessionId } = await br.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)
  return sessionId
}
async function swEval(expression) {
  const sessionId = await ensureSWSession()
  const r = await br.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  return r.result?.value
}

// 注入配置并回读校验
const cfgJson = await swEval(`(async () => {
  const KEY = 'tv:config_v1';
  const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  cur.uiLang = ${JSON.stringify(uiLang)};
  cur.onboardingCompleted = true;
  cur.general = Object.assign({}, cur.general, { targetLang: ${JSON.stringify(targetLang)} });
  cur.engine = Object.assign({}, cur.engine, {
    provider: 'aimao',
    keys: Object.assign({}, cur.engine && cur.engine.keys, { aimao: ${JSON.stringify(AIMAO_KEY)} }),
    aimao: Object.assign({}, cur.engine && cur.engine.aimao, { model: ${JSON.stringify(AIMAO_MODEL)} }),
  });
  await chrome.storage.local.set({ [KEY]: cur });
  const back = (await chrome.storage.local.get(KEY))[KEY] || {};
  return JSON.stringify({
    uiLang: back.uiLang,
    targetLang: back.general && back.general.targetLang,
    provider: back.engine && back.engine.provider,
    keyPrefix: String(back.engine && back.engine.keys && back.engine.keys.aimao || '').slice(0, 5),
    model: back.engine && back.engine.aimao && back.engine.aimao.model,
  });
})()`)
const cfg = JSON.parse(cfgJson || '{}')
console.log('config:', cfgJson)
if (cfg.provider !== 'aimao' || cfg.keyPrefix !== 'sk-f0' || cfg.model !== AIMAO_MODEL) {
  throw new Error('config injection failed: ' + cfgJson)
}
if (cfg.uiLang !== uiLang || cfg.targetLang !== targetLang) {
  throw new Error('uiLang/targetLang not persisted: ' + cfgJson)
}

// ---- 3. 测试页 ----
let pageId
{
  const t = await br.send('Target.getTargets')
  const found = t.targetInfos.find((x) => x.type === 'page' && x.url.includes('127.0.0.1:8137'))
  if (found) {
    pageId = found.targetId
    // 旧测试页 URL 可能不同（test-page.html），统一导航到目标页
  } else {
    pageId = (await br.send('Target.createTarget', { url: PAGE })).targetId
  }
}
const { sessionId } = await br.send('Target.attachToTarget', { targetId: pageId, flatten: true })
await br.send('Page.enable', {}, sessionId)
await br.send('Runtime.enable', {}, sessionId)
await br.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId)
await br.send('Page.navigate', { url: PAGE }, sessionId)
await sleep(4000)

// 诊断：内容脚本是否就位（悬浮球存在即已注入）
{
  const cs = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify({
      ball: !!document.querySelector('.tv-ball'),
      tvEls: document.querySelectorAll('tv-translation,[data-tv-owned]').length,
      ready: document.readyState,
      title: document.title.slice(0, 40),
    }))()`,
    returnByValue: true,
  }, sessionId)
  console.log('content script check:', cs.result?.value)
}

// ---- 4. 触发整页翻译（SW → content script，可靠路径）----
// 扩展无 "tabs" 权限时 tab.url 不可见，故先激活测试页目标，再取活动标签
await br.send('Target.activateTarget', { targetId: pageId }).catch(() => {})
const trig = await swEval(`(async () => {
  const all = await chrome.tabs.query({});
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  const diag = 'tabs=' + all.length + ' activeId=' + (tab && tab.id) + ' win=' + (tab && tab.windowId);
  if (!tab) return 'NO_TAB|' + diag;
  for (let i = 0; i < 3; i++) {
    try {
      await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' });
      return 'SENT|' + diag;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return 'SEND_FAILED|' + diag;
})()`)
console.log('trigger:', trig)
if (!trig || !trig.startsWith('SENT')) throw new Error('togglePage not delivered: ' + trig)

// ---- 5. 轮询翻译完成 ----
const pollExpr = `(() => {
  const trs = Array.from(document.querySelectorAll('tv-translation'));
  const done = trs.filter((t) => (t.innerText || '').trim().length > 0).length;
  const loading = document.querySelectorAll('[data-tv-loading]').length;
  const errors = Array.from(document.querySelectorAll('[data-tv-error]'));
  const first = trs.find((t) => (t.innerText || '').trim()) || null;
  return JSON.stringify({
    total: trs.length, done, loading,
    errCount: errors.length,
    errText: errors[0] ? errors[0].innerText.slice(0, 120) : '',
    first: first ? first.innerText.trim().slice(0, 60) : '',
  });
})()`
async function pageState() {
  const r = await br.send('Runtime.evaluate', { expression: pollExpr, returnByValue: true }, sessionId)
  return JSON.parse(r.result?.value || '{}')
}

let state = { total: 0, done: 0, loading: 0, errCount: 0 }
let stable = 0
const deadline = Date.now() + 90000
while (Date.now() < deadline) {
  await sleep(2000)
  state = await pageState()
  if (state.errCount > 0) throw new Error('translation error on page: ' + (state.errText || '?'))
  if (state.done > 0 && state.loading === 0) {
    stable++
    if (stable >= 2) break
  } else {
    stable = 0
  }
}
console.log('page state:', JSON.stringify(state))
if (state.done === 0 || state.errCount > 0) throw new Error('translation incomplete: ' + JSON.stringify(state))

// ---- 6. 截图 1：双语整页 ----
const dir = join(OUT, dirName)
mkdirSync(dir, { recursive: true })
const s1 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync(join(dir, 'screenshot-1-bilingual.png'), Buffer.from(s1.data, 'base64'))
console.log('saved: screenshot-1-bilingual.png')

// ---- 7. 截图 2：划词气泡 ----
await br.send('Runtime.evaluate', {
  expression: `(function() {
    var p = document.querySelectorAll('p')[1] || document.querySelector('p');
    var range = document.createRange();
    range.selectNodeContents(p);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return 'SEL';
  })()`,
  returnByValue: true,
}, sessionId)
// 轮询气泡译文出现
let bubbleText = ''
const bubbleDeadline = Date.now() + 40000
while (Date.now() < bubbleDeadline) {
  await sleep(1500)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => {
      var pop = document.querySelector('.tv-sel-popup');
      var tr = pop && pop.querySelector('.tv-sel-translation');
      return pop && tr ? (tr.innerText || '').trim().slice(0, 60) : '';
    })()`,
    returnByValue: true,
  }, sessionId)
  bubbleText = r.result?.value || ''
  if (bubbleText) break
}
console.log('bubble:', bubbleText)
if (!bubbleText) throw new Error('selection bubble translation missing')
const s2 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync(join(dir, 'screenshot-2-selection.png'), Buffer.from(s2.data, 'base64'))
console.log('saved: screenshot-2-selection.png')

// ---- 8. 截图 3：设置页（目标界面语言）----
await br.send('Page.navigate', { url: `${EXT}/options.html` }, sessionId)
await sleep(4000)
const optCheck = await br.send('Runtime.evaluate', {
  expression: `(() => {
    var h = document.querySelector('h1, h2, .opt-title, header');
    return document.documentElement.lang + '|' + (h ? h.innerText.slice(0, 40) : '') + '|' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300);
  })()`,
  returnByValue: true,
}, sessionId)
console.log('options page:', optCheck.result?.value)
const s3 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync(join(dir, 'screenshot-3-options.png'), Buffer.from(s3.data, 'base64'))
console.log('saved: screenshot-3-options.png')

console.log('DONE ' + dirName)
process.exit(0)
