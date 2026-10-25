// 第三轮：de/fr 语言下设置页全部按钮/标签的溢出测量
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

async function findSW() {
  const t = await br.send('Target.getTargets')
  return t.targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(EXT)) || null
}
async function swEval(expression) {
  let sw = await findSW()
  if (!sw) {
    const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/popup.html` })
    for (let i = 0; i < 20 && !sw; i++) { await sleep(500); sw = await findSW() }
    await br.send('Target.closeTarget', { targetId }).catch(() => {})
  }
  const { sessionId } = await br.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)
  const r = await br.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  return r.result?.value
}

const out = {}
for (const lang of ['de', 'fr']) {
  await swEval(`(async () => {
    const KEY = 'tv:config_v1';
    const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
    cur.uiLang = '${lang}';
    await chrome.storage.local.set({ [KEY]: cur });
    return 'ok';
  })()`)
  const { targetId: optId } = await br.send('Target.createTarget', { url: `${EXT}/options.html` })
  await sleep(3500)
  const { sessionId } = await br.send('Target.attachToTarget', { targetId: optId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)
  const tabs = ['engine', 'experts', 'style', 'privacy', 'glossaryLibs', 'writing', 'tts', 'interaction', 'hotkeys', 'general']
  const findings = []
  for (const tab of tabs) {
    await br.send('Runtime.evaluate', {
      expression: `(function(){ var b = document.querySelector('[data-tab="${tab}"]'); if (b) b.click(); })()`,
      returnByValue: true,
    }, sessionId)
    await sleep(700)
    const r = await br.send('Runtime.evaluate', {
      expression: `(() => JSON.stringify((function(){
        var bad = [];
        document.querySelectorAll('button, .nav-btn, .chip, [class*=btn]').forEach(function(b){
          if (!b.offsetParent) return; // 不可见跳过
          var overflowY = b.scrollHeight > b.clientHeight + 2 && b.clientHeight > 0;
          var overflowX = b.scrollWidth > b.clientWidth + 2 && b.clientWidth > 0;
          if (overflowY || overflowX) bad.push({
            cls: (b.className || '').toString().slice(0, 40),
            text: (b.innerText || '').trim().slice(0, 30),
            h: b.clientHeight, scrollH: b.scrollHeight, w: b.clientWidth, scrollW: b.scrollWidth,
          });
        });
        return bad;
      })()))()`,
      returnByValue: true,
    }, sessionId)
    const bad = JSON.parse(r.result?.value || '[]')
    if (bad.length) findings.push({ tab, bad })
  }
  out[lang] = findings
  console.log(`[options ${lang}] 溢出按钮 ${findings.reduce((n, f) => n + f.bad.length, 0)} 处`)
  for (const f of findings) for (const b of f.bad) console.log('   ', f.tab, '|', b.cls, '|', b.text, '|', b.w + 'x' + b.h, 'scroll', b.scrollW + 'x' + b.scrollH)
  await br.send('Target.closeTarget', { targetId: optId }).catch(() => {})
}
writeFileSync(join('C:/Users/Admin/Documents/浏览器翻译-kimi/docs/audit-shots', 'audit-data3.json'), JSON.stringify(out, null, 1))
console.log('AUDIT3 DONE')
process.exit(0)
