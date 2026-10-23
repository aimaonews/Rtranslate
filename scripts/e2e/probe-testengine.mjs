// 验证 testEngine 消息（在扩展页 review.html 上下文里发）
const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
function mk(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)
const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/review.html` })
let info = null
for (let i = 0; i < 15; i++) {
  await sleep(400)
  const list = await (await fetch(CDP + '/json/list')).json()
  info = list.find((x) => x.id === targetId)
  if (info) break
}
const pg = await mk(info.webSocketDebuggerUrl)
await pg.send('Runtime.enable')
const r = await pg.send('Runtime.evaluate', {
  expression: `chrome.runtime.sendMessage({ kind: 'testEngine' }).then(r => JSON.stringify(r))`,
  awaitPromise: true,
  returnByValue: true,
})
console.log('testEngine result:', r.result?.value ?? JSON.stringify(r).slice(0, 300))
await br.send('Target.closeTarget', { targetId })
process.exit(0)
