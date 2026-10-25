// 验证词汇库 tab：zh-TW 与 en 两界面下乱码消失、计数插值正常
const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'

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

for (const lang of ['zh-TW', 'en', 'de']) {
  await swEval(`(async () => {
    const KEY = 'tv:config_v1';
    const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
    cur.uiLang = '${lang}';
    await chrome.storage.local.set({ [KEY]: cur });
    return 'ok';
  })()`)
  const t = await br.send('Target.getTargets')
  for (const ti of t.targetInfos) if (ti.type === 'page' && ti.url.startsWith(EXT)) await br.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {})
  const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/options.html` })
  await sleep(3200)
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)
  await br.send('Runtime.evaluate', {
    expression: `(function(){ var b = document.querySelector('[data-tab="glossaryLibs"]'); if (b) b.click(); })()`,
    returnByValue: true,
  }, sessionId)
  await sleep(1000)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => {
      var txt = document.body.innerText;
      return JSON.stringify({
        garbled: txt.indexOf('$' + '{') >= 0,
        libs: (txt.match(/(Programming|Web3|Twitter|AO3|Education|Game|编程|推特|教育|游戏)[^\\n]{0,18}/g) || []).slice(0, 6),
      });
    })()`,
    returnByValue: true,
  }, sessionId)
  console.log(`[${lang}]`, r.result?.value)
  await br.send('Target.closeTarget', { targetId }).catch(() => {})
}
process.exit(0)
