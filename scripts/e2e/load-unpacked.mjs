// 用 CDP Extensions 域加载未打包扩展
const v = await (await fetch('http://127.0.0.1:9222/json/version')).json()
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
const br = await mk(v.webSocketDebuggerUrl)
const dist = process.argv[2]
try {
  const r = await br.send('Extensions.loadUnpacked', { path: dist })
  console.log('loadUnpacked OK:', JSON.stringify(r))
} catch (e) {
  console.log('loadUnpacked FAILED:', String(e))
}
await new Promise((r) => setTimeout(r, 2000))
const t = await br.send('Target.getTargets')
console.log('targets:', JSON.stringify(t.targetInfos.map((x) => ({ type: x.type, url: x.url.slice(0, 90) }))))
process.exit(0)
