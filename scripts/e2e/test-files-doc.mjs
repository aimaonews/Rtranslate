// 功能实测：文档翻译（TXT 上传 → 解析 → 翻译 → 结果区双语）+ 引擎连通性按钮
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
const ROOT = 'C:/Users/Admin/Documents/浏览器翻译-kimi'

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

// 测试用 TXT（英文，3 段）
const txtPath = join(ROOT, 'scripts', 'e2e', 'doc-test.txt')
writeFileSync(txtPath, [
  'The Quiet Power of Slow Technology.',
  'In an industry obsessed with speed, a small movement of developers is rediscovering the value of doing less.',
  'Notifications arrive in batches instead of interrupting every few minutes.',
  '',
].join('\n'))

const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)

async function findSW() {
  const t = await br.send('Target.getTargets')
  return t.targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(EXT)) || null
}
async function swEval(expression) {
  let sw = await findSW()
  if (!sw) {
    const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/popup.html` })
    for (let i = 0; i < 20 && !sw; i++) { await sleep(500); sw = await findSW() }
    await br.send('Target.closeTarget', { targetId }).catch(() => {})
  }
  const { sessionId } = await br.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)
  const r = await br.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  return r.result?.value
}

// 界面 zh-CN（按钮文案断言用中文）
await swEval(`(async () => {
  const KEY = 'tv:config_v1';
  const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  cur.uiLang = 'zh-CN';
  await chrome.storage.local.set({ [KEY]: cur });
  return 'ok';
})()`)

const t = await br.send('Target.getTargets')
for (const ti of t.targetInfos) if (ti.type === 'page' && ti.url.startsWith(EXT)) await br.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {})
const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/files.html` })
await sleep(3000)
const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true })
await br.send('Page.enable', {}, sessionId)
await br.send('Runtime.enable', {}, sessionId)
await br.send('DOM.enable', {}, sessionId)

// 1. 找到文件 input 并注入文件
const doc = await br.send('DOM.getDocument', {}, sessionId)
const node = await br.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' }, sessionId)
console.log('file input found:', node.nodeId > 0)
await br.send('DOM.setFileInputFiles', { files: [txtPath], nodeId: node.nodeId }, sessionId)
await sleep(2500)

// 2. 检查解析结果（文件名/段数）
const parsed = await br.send('Runtime.evaluate', {
  expression: `(() => JSON.stringify({
    body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    hasFile: !!document.querySelector('.file-chip, .file-name, [class*=file]'),
  }))()`,
  returnByValue: true,
}, sessionId)
console.log('after upload:', parsed.result?.value)

// 3. 点击 开始翻译
const clicked = await br.send('Runtime.evaluate', {
  expression: `(() => {
    var btns = Array.from(document.querySelectorAll('button'));
    var b = btns.find(function(x){ return /开始翻译|翻译/.test(x.textContent) && !/重新/.test(x.textContent); });
    if (b) { b.click(); return 'clicked: ' + b.textContent.trim(); }
    return 'no button; buttons=' + btns.map(function(x){return x.textContent.trim();}).slice(0,10).join('/');
  })()`,
  returnByValue: true,
}, sessionId)
console.log('translate button:', clicked.result?.value)

// 4. 等翻译完成（最多 90s，轮询结果区）
let done = false, resultText = ''
for (let i = 0; i < 30; i++) {
  await sleep(3000)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => {
      var t = document.body.innerText;
      var hasZh = /[\\u4e00-\\u9fff]{4,}/.test(t);
      var busy = /翻译中|Translating/.test(t);
      return JSON.stringify({ hasZh: hasZh, busy: busy, len: t.length });
    })()`,
    returnByValue: true,
  }, sessionId)
  const d = JSON.parse(r.result?.value || '{}')
  if (d.hasZh && !d.busy) { done = true; break }
}
const final = await br.send('Runtime.evaluate', {
  expression: `(() => document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500))()`,
  returnByValue: true,
}, sessionId)
console.log('translation done:', done)
console.log('page text:', final.result?.value?.slice(0, 400))

// 5. 引擎连通性（options 引擎 tab 的 测试连接）
await br.send('Page.navigate', { url: `${EXT}/options.html` }, sessionId)
await sleep(3000)
await br.send('Runtime.evaluate', {
  expression: `(function(){ var b = document.querySelector('[data-tab="engine"]'); if (b) b.click(); })()`,
  returnByValue: true,
}, sessionId)
await sleep(800)
const testBtn = await br.send('Runtime.evaluate', {
  expression: `(() => {
    var btns = Array.from(document.querySelectorAll('button'));
    var b = btns.find(function(x){ return /测试连接/.test(x.textContent); });
    if (b) { b.click(); return 'clicked'; }
    return 'not found';
  })()`,
  returnByValue: true,
}, sessionId)
console.log('test connection:', testBtn.result?.value)
await sleep(12000)
const connResult = await br.send('Runtime.evaluate', {
  expression: `(() => {
    var t = document.body.innerText;
    var m = t.match(/连接[^\n]{0,60}/);
    return m ? m[0] : 'no result text';
  })()`,
  returnByValue: true,
}, sessionId)
console.log('connectivity result:', connResult.result?.value)

await br.send('Target.closeTarget', { targetId }).catch(() => {})
console.log('\nFUNCTIONAL TEST DONE')
process.exit(0)
