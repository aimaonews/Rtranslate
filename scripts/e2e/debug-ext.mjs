const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && (t.url.includes('extensions') || t.url.includes('8137')))
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
const pg = await mk(page.webSocketDebuggerUrl)
await pg.send('Page.enable')
await pg.send('Page.navigate', { url: 'edge://extensions/' })
await new Promise((r) => setTimeout(r, 5000))
const r = await pg.send('Runtime.evaluate', {
  expression: `(() => {
    const em = document.querySelector('extensions-manager');
    const root = em && em.shadowRoot ? em.shadowRoot : document;
    return (root.textContent || '').replace(/\\s+/g, ' ').slice(0, 2500);
  })()`,
  returnByValue: true,
})
console.log(r.result?.value ?? JSON.stringify(r).slice(0, 300))
process.exit(0)
