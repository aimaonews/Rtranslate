// 简化版截图：直接导航到 options/onboarding/privacy 截取
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'audit')
mkdirSync(OUT, { recursive: true })

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
const tab = list0.find((t) => t.type === 'page')
if (!tab) throw new Error('no page tab')

const pg = await mk(tab.webSocketDebuggerUrl)
await pg.send('Page.enable')
await pg.send('Runtime.enable')

async function shot(name) {
  const s = await pg.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'))
  console.log(name)
}

// options 页各标签
await pg.send('Page.navigate', { url: EXT + '/options.html' })
await sleep(2500)
for (const t of ['tts', 'hotkeys']) {
  await pg.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-tab="${t}"]')?.click()`,
    returnByValue: true,
  })
  await sleep(800)
  await shot(`02-options-${t}.png`)
}

// onboarding
await pg.send('Page.navigate', { url: EXT + '/onboarding.html' })
await sleep(2500)
await shot('07-onboarding-step1.png')

// privacy
await pg.send('Page.navigate', { url: EXT + '/privacy.html' })
await sleep(2000)
await shot('08-privacy.png')

console.log('done')
process.exit(0)
