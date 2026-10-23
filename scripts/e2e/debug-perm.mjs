// 调试：SW 内 tabs.query 与 fetch 行为
const v = await (await fetch('http://127.0.0.1:9222/json/version')).json()
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
const br = await mk(v.webSocketDebuggerUrl)
// 先重载页面让内容脚本唤醒 SW
{
  const t0 = await br.send('Target.getTargets')
  const pg = t0.targetInfos.find((x) => x.type === 'page' && x.url.includes('8137'))
  if (pg) {
    const { sessionId: psid } = await br.send('Target.attachToTarget', { targetId: pg.targetId, flatten: true })
    await br.send('Page.reload', {}, psid)
  }
}
await new Promise((r) => setTimeout(r, 4000))
let sw = null
for (let i = 0; i < 20; i++) {
  const t = await br.send('Target.getTargets')
  sw = t.targetInfos.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
  if (sw) break
  await new Promise((r) => setTimeout(r, 500))
}
if (!sw) { console.log('no sw'); process.exit(1) }
const { sessionId } = await br.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
await br.send('Runtime.enable', {}, sessionId)
const r = await br.send('Runtime.evaluate', {
  expression: `(async () => {
    const out = {};
    out.tabsAll = (await chrome.tabs.query({})).map(t => t.url);
    out.perms = await chrome.permissions.getAll();
    try {
      const resp = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=hello');
      out.googleFetchStatus = resp.status;
      out.googleFetchBody = (await resp.text()).slice(0, 120);
    } catch (e) {
      out.googleFetchError = String(e);
    }
    return out;
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId)
console.log(JSON.stringify(r.result?.value ?? r, null, 1))
process.exit(0)
