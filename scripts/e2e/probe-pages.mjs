// 验证新页面渲染：options（10 标签）、files（文档翻译）
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

async function probe(url, expr) {
  const { targetId } = await br.send('Target.createTarget', { url })
  let info = null
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    const list = await (await fetch(CDP + '/json/list')).json()
    info = list.find((x) => x.id === targetId)
    if (info) break
  }
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  await sleep(1800)
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  c.close()
  await br.send('Target.closeTarget', { targetId })
  return r.result?.value ?? r.exceptionDetails?.exception?.description
}

console.log('options tabs:', JSON.stringify(await probe(`${EXT}/options.html`, `
  [...document.querySelectorAll('.nav-btn')].map(b => b.textContent)
`)))
console.log('options experts tab:', JSON.stringify(await probe(`${EXT}/options.html`, `
  (() => { const btns = [...document.querySelectorAll('.nav-btn')]; const t = btns.find(b => b.textContent.includes('专家')); if (t) { t.click(); } return new Promise(r => setTimeout(() => r(document.querySelector('.content')?.innerText.slice(0, 200)), 800)); })()
`)))
console.log('files page:', JSON.stringify(await probe(`${EXT}/files.html`, `
  ({ title: document.title, text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220), hasDrop: !!document.querySelector('[class*=drop], [class*=upload], input[type=file]') })
`)))
process.exit(0)
