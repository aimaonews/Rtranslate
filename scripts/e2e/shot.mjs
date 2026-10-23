// 截取已翻译测试页的截图
import { writeFileSync } from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('8137'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method: m, params: p }))
  })
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result)
  }
}
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(new URL('./screenshot-translated.png', import.meta.url), Buffer.from(shot.data, 'base64'))
console.log('saved')
process.exit(0)
