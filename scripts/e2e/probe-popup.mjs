// 验证 popup 站点规则区：域名显示、开关切换、互斥、立即翻译
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

// 启动 URL 在扩展就绪前加载，先重载测试页注入内容脚本
{
  const list0 = await (await fetch(CDP + '/json/list')).json()
  const tp = list0.find((x) => x.type === 'page' && x.url.includes('8137'))
  if (tp) {
    const tc = await mk(tp.webSocketDebuggerUrl)
    await tc.send('Page.enable')
    await tc.send('Page.reload', { ignoreCache: true })
    tc.close()
    await sleep(3500)
  }
}

// popup 以标签页打开；background:true 保持测试页为活动标签（模拟真实 popup 覆盖在活动页上的场景）
const { targetId: popupId } = await br.send('Target.createTarget', { url: `${EXT}/popup.html`, background: true })
let popupInfo = null
for (let i = 0; i < 15; i++) {
  await sleep(400)
  const list = await (await fetch(CDP + '/json/list')).json()
  popupInfo = list.find((x) => x.id === popupId)
  if (popupInfo) break
}
const pc = await mk(popupInfo.webSocketDebuggerUrl)
await pc.send('Runtime.enable')
await sleep(2000)

const r1 = await pc.send('Runtime.evaluate', {
  expression: `(() => {
    const host = document.querySelector('.site-host')?.textContent ?? null;
    const rows = [...document.querySelectorAll('.site-rules .row')].map(r => ({
      label: r.querySelector('.row-label')?.textContent,
      on: r.querySelector('.switch')?.classList.contains('on'),
      disabled: r.classList.contains('is-disabled'),
    }));
    return { host, rows };
  })()`,
  returnByValue: true,
})
console.log('初始状态:', JSON.stringify(r1.result.value))

// 点击"总是翻译此网站"
await pc.send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('.site-rules .row')].find(r => r.querySelector('.row-label')?.textContent.includes('总是'))?.querySelector('.switch')?.click()`,
  returnByValue: true,
})
await sleep(2500)

const r2 = await pc.send('Runtime.evaluate', {
  expression: `(async () => {
    const cfg = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'];
    const rows = [...document.querySelectorAll('.site-rules .row')].map(r => ({
      label: r.querySelector('.row-label')?.textContent,
      on: r.querySelector('.switch')?.classList.contains('on'),
    }));
    return { auto: cfg.general.autoTranslateSites, never: cfg.general.neverTranslateSites, rows };
  })()`,
  returnByValue: true, awaitPromise: true,
})
console.log('开启总是翻译后:', JSON.stringify(r2.result.value))

// 点击"永不翻译网站"（应互斥：auto 清空，never 加入）
await pc.send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('.site-rules .row')].find(r => r.querySelector('.row-label')?.textContent.includes('永不'))?.querySelector('.switch')?.click()`,
  returnByValue: true,
})
await sleep(1500)
const r3 = await pc.send('Runtime.evaluate', {
  expression: `(async () => {
    const cfg = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'];
    const rows = [...document.querySelectorAll('.site-rules .row')].map(r => ({
      label: r.querySelector('.row-label')?.textContent,
      on: r.querySelector('.switch')?.classList.contains('on'),
    }));
    return { auto: cfg.general.autoTranslateSites, never: cfg.general.neverTranslateSites, rows };
  })()`,
  returnByValue: true, awaitPromise: true,
})
console.log('开启永不翻译后:', JSON.stringify(r3.result.value))
process.exit(0)
