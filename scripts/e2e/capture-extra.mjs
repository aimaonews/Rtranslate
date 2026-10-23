// 补齐截图：options 的 tts/hotkeys 标签 + onboarding 三步
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

const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)
const OUT = 'C:/Users/Admin/Documents/浏览器翻译-kimi/scripts/e2e/audit/'

// 1. options 的 tts / hotkeys 标签
{
  const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/options.html`, background: true })
  await sleep(2500)
  const list = await (await fetch(CDP + '/json/list')).json()
  const info = list.find((x) => x.id === targetId)
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  for (const tab of ['tts', 'hotkeys']) {
    await c.send('Runtime.evaluate', { expression: `document.querySelector('[data-tab="${tab}"]')?.click()` })
    await sleep(700)
    const shot = await c.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(OUT + `02-options-${tab}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`02-options-${tab}.png`)
  }
  await br.send('Target.closeTarget', { targetId })
}

// 2. onboarding 三步（每次新开，点击下一步到对应步）
for (const step of [1, 2, 3]) {
  const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/onboarding.html`, background: true })
  await sleep(2200)
  const list = await (await fetch(CDP + '/json/list')).json()
  const info = list.find((x) => x.id === targetId)
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  for (let i = 1; i < step; i++) {
    await c.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('button')].find(b => /下一步|Next/.test(b.textContent))?.click()`,
    })
    await sleep(500)
  }
  await sleep(600)
  const shot = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT + `07-onboarding-step${step}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`07-onboarding-step${step}.png`)
  await br.send('Target.closeTarget', { targetId })
}
console.log('done')
process.exit(0)
