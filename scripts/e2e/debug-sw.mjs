// 调试：检查内容脚本注入 + 唤醒 SW
const v = await (await fetch('http://127.0.0.1:9222/json/version')).json()
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('8137'))

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
const pg = await mk(page.webSocketDebuggerUrl)
await pg.send('Runtime.enable')
await pg.send('Page.enable')
await pg.send('Page.reload', { ignoreCache: true })
await new Promise((r) => setTimeout(r, 3500))

const evalJson = async (expr) => {
  const r = await pg.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { exception: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}

console.log('probe1:', JSON.stringify(await evalJson(`(() => {
  try {
    return {
      hasChrome: typeof chrome !== 'undefined',
      hasRuntime: typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id),
      extId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null,
    }
  } catch (e) { return { err: e.message } }
})()`)))

console.log('probe2 sendMessage:', JSON.stringify(await evalJson(`new Promise((resolve) => {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) return resolve('no chrome.runtime')
    chrome.runtime.sendMessage({ kind: 'getStats' }, (resp) => {
      resolve({ resp: String(resp), lastError: chrome.runtime.lastError ? String(chrome.runtime.lastError) : null })
    })
    setTimeout(() => resolve('timeout-no-callback'), 5000)
  } catch (e) { resolve('err:' + e.message) }
})`)))

await new Promise((r) => setTimeout(r, 2500))
const t = await br.send('Target.getTargets')
console.log('targets now:', JSON.stringify(t.targetInfos.map((x) => ({ type: x.type, url: x.url.slice(0, 90) }))))
process.exit(0)
