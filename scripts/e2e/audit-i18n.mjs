// i18n 审计取证：英文 UI 下逐 tab 抓取设置页中文残留 + popup/扩展页 + 气泡按钮溢出测量
// 只读，不改任何配置代码；uiLang 通过 storage 直写（审计结束恢复 en 状态无关紧要，报告提交后由用户决定）
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9222'
const EXT = 'chrome-extension://obommjidieecapideeemdlcegndcdnkd'
const OUT = 'C:/Users/Admin/Documents/浏览器翻译-kimi/docs/audit-shots'

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
const CJK = /[\u4e00-\u9fff]/

const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)

// SW 会话
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

// 1. 关闭扩展旧页 + 设 uiLang=en
{
  const t = await br.send('Target.getTargets')
  for (const ti of t.targetInfos) if (ti.type === 'page' && ti.url.startsWith(EXT)) await br.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {})
}
console.log('uiLang set:', await swEval(`(async () => {
  const KEY = 'tv:config_v1';
  const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  cur.uiLang = 'en';
  cur.onboardingCompleted = true;
  await chrome.storage.local.set({ [KEY]: cur });
  return (await chrome.storage.local.get(KEY))[KEY].uiLang;
})()`))

// 2. 打开设置页，逐 tab 抓中文
const { targetId: optId } = await br.send('Target.createTarget', { url: `${EXT}/options.html` })
await sleep(4000)
const { sessionId } = await br.send('Target.attachToTarget', { targetId: optId, flatten: true })
await br.send('Page.enable', {}, sessionId)
await br.send('Runtime.enable', {}, sessionId)
await br.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

const tabs = ['general', 'engine', 'experts', 'style', 'privacy', 'glossary', 'glossaryLibs', 'writing', 'tts', 'words', 'interaction', 'hotkeys']
mkdirSync(OUT, { recursive: true })
const tabReport = {}
for (const tab of tabs) {
  await br.send('Runtime.evaluate', {
    expression: `(function(){ var b = document.querySelector('[data-tab="${tab}"]'); if (b) b.click(); return !!b; })()`,
    returnByValue: true,
  }, sessionId)
  await sleep(900)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => {
      var lines = document.querySelector('.content, main, body').innerText.split('\\n').filter(function(l){ return /[\\u4e00-\\u9fff]/.test(l); });
      return JSON.stringify({ cjkLines: lines.slice(0, 40), count: lines.length });
    })()`,
    returnByValue: true,
  }, sessionId)
  const data = JSON.parse(r.result?.value || '{}')
  tabReport[tab] = data
  const s1 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(join(OUT, `audit-options-${tab}.png`), Buffer.from(s1.data, 'base64'))
  console.log(`[tab] ${tab}: ${data.count} CJK lines`)
  if (data.count > 0 && data.cjkLines) console.log('   e.g.:', data.cjkLines.slice(0, 3).join(' | ').slice(0, 150))
}

// 3. popup 页（作为页面打开）
await br.send('Page.navigate', { url: `${EXT}/popup.html` }, sessionId)
await sleep(2500)
{
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify({ cjkLines: document.body.innerText.split('\\n').filter(function(l){return /[\\u4e00-\\u9fff]/.test(l);}).slice(0,30), count: 1 }))()`,
    returnByValue: true,
  }, sessionId)
  const s2 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(join(OUT, 'audit-popup.png'), Buffer.from(s2.data, 'base64'))
  const d = JSON.parse(r.result?.value || '{}')
  tabReport.popup = d
  console.log('[popup] CJK:', d.cjkLines.join(' | ').slice(0, 200))
}

// 4. onboarding / files / review 页
for (const page of ['onboarding', 'files', 'review']) {
  await br.send('Page.navigate', { url: `${EXT}/${page}.html` }, sessionId)
  await sleep(2500)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify(document.body.innerText.split('\\n').filter(function(l){return /[\\u4e00-\\u9fff]/.test(l);}).slice(0,30)))()`,
    returnByValue: true,
  }, sessionId)
  const s3 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(join(OUT, `audit-${page}.png`), Buffer.from(s3.data, 'base64'))
  const lines = JSON.parse(r.result?.value || '[]')
  tabReport[page] = lines
  console.log(`[${page}] CJK ${lines.length}:`, lines.slice(0, 4).join(' | ').slice(0, 160))
}

// 5. 气泡按钮溢出测量（fr/de/pt 语言下，选中段落触发气泡）
await br.send('Page.navigate', { url: 'http://127.0.0.1:8137/test-page-shot.html' }, sessionId)
await sleep(3000)
const bubbleMeasures = {}
for (const lang of ['fr', 'de', 'pt-BR', 'ja', 'en']) {
  await swEval(`(async () => {
    const KEY = 'tv:config_v1';
    const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
    cur.uiLang = '${lang}';
    await chrome.storage.local.set({ [KEY]: cur });
    return 'ok';
  })()`)
  // 重载页面让内容脚本以新语言初始化
  await br.send('Page.reload', {}, sessionId)
  await sleep(3500)
  await br.send('Runtime.evaluate', {
    expression: `(function() {
      var p = document.querySelectorAll('p')[1];
      var range = document.createRange();
      range.selectNodeContents(p);
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return 1;
    })()`,
    returnByValue: true,
  }, sessionId)
  await sleep(2500)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify((function(){
      var pop = document.querySelector('.tv-sel-popup');
      if (!pop) return { noPopup: true };
      var out = [];
      pop.querySelectorAll('.tv-sel-btn').forEach(function(b){
        var rect = b.getClientRects();
        var range = document.createRange(); range.selectNodeContents(b);
        var lines = Array.from(range.getClientRects()).filter(function(r){ return r.width > 2; }).length;
        out.push({
          label: (b.innerText || '').trim(),
          scrollW: b.scrollWidth, clientW: b.clientWidth,
          overflow: b.scrollWidth > b.clientWidth + 1,
          lines: lines
        });
      });
      return { lang: document.documentElement.lang || '?', buttons: out };
    })()))()`,
    returnByValue: true,
  }, sessionId)
  const data = JSON.parse(r.result?.value || '{}')
  bubbleMeasures[lang] = data
  const s4 = await br.send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(join(OUT, `audit-bubble-${lang}.png`), Buffer.from(s4.data, 'base64'))
  if (data.buttons) {
    const bad = data.buttons.filter((b) => b.overflow || b.lines > 1)
    console.log(`[bubble ${lang}] buttons=${data.buttons.length} 异常=${bad.length}`, bad.map((b) => b.label + '(' + (b.overflow ? '溢出' : '') + (b.lines > 1 ? b.lines + '行' : '') + ')').join(', ').slice(0, 200))
  } else {
    console.log(`[bubble ${lang}]`, JSON.stringify(data).slice(0, 80))
  }
}

writeFileSync(join(OUT, 'audit-data.json'), JSON.stringify({ tabReport, bubbleMeasures }, null, 1))
console.log('\nAUDIT DONE →', OUT)
process.exit(0)
