// 截取隐私政策页（中文+英文）— 找任意可用页面标签导航
import { writeFileSync } from 'node:fs'
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

const list0 = await (await fetch(CDP + '/json/list')).json()
console.log('available tabs:', list0.filter(t => t.type === 'page').map(t => t.url.slice(0, 60)))

// 找任意 page 类型标签
const tab = list0.find((t) => t.type === 'page')
if (!tab) throw new Error('no page tab available')

const pg = await mk(tab.webSocketDebuggerUrl)
await pg.send('Page.enable')
await pg.send('Runtime.enable')
await pg.send('Page.navigate', { url: EXT + '/privacy.html' })
await sleep(3000)

const shot1 = await pg.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(new URL('./audit/08-privacy.png', import.meta.url), Buffer.from(shot1.data, 'base64'))
console.log('privacy zh captured')

await pg.send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('.lang-btn')].find(b => b.textContent.includes('English'))?.click()`,
  returnByValue: true,
})
await sleep(800)
const shot2 = await pg.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(new URL('./audit/08-privacy-en.png', import.meta.url), Buffer.from(shot2.data, 'base64'))
console.log('privacy en captured')

// 导航回测试页
await pg.send('Page.navigate', { url: 'http://127.0.0.1:8137/test-page.html' })
process.exit(0)
