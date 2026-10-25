// 第二轮取证：气泡按钮高度溢出 + popup 元素定位 + files 页明细
import { writeFileSync } from 'node:fs'
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

const report = {}

// A. 气泡按钮：宽度+高度溢出、字体大小、popup 宽度
await swEval(`(async () => {
  const KEY = 'tv:config_v1';
  const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  cur.uiLang = 'fr';
  await chrome.storage.local.set({ [KEY]: cur });
  return 'ok';
})()`)
let t = await br.send('Target.getTargets')
let page = t.targetInfos.find((x) => x.type === 'page' && x.url.includes('8137'))
if (!page) page = { targetId: (await br.send('Target.createTarget', { url: 'http://127.0.0.1:8137/test-page-shot.html' })).targetId }
const { sessionId } = await br.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
await br.send('Page.enable', {}, sessionId)
await br.send('Runtime.enable', {}, sessionId)
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
{
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify((function(){
      var pop = document.querySelector('.tv-sel-popup');
      if (!pop) return { noPopup: true };
      var pr = pop.getBoundingClientRect();
      var btns = [];
      pop.querySelectorAll('.tv-sel-btn').forEach(function(b){
        var br2 = b.getBoundingClientRect();
        var cs = getComputedStyle(b);
        btns.push({
          label: (b.innerText || '').trim(),
          w: Math.round(br2.width), h: Math.round(br2.height),
          scrollW: b.scrollWidth, scrollH: b.scrollHeight,
          overflowX: b.scrollWidth > Math.round(br2.width) + 1,
          overflowY: b.scrollHeight > Math.round(br2.height) + 1,
          whiteSpace: cs.whiteSpace, fontSize: cs.fontSize,
          padV: cs.paddingTop + '/' + cs.paddingBottom,
        });
      });
      return { popupW: Math.round(pr.width), popupH: Math.round(pr.height), buttons: btns };
    })()))()`,
    returnByValue: true,
  }, sessionId)
  report.bubbleFr = JSON.parse(r.result?.value || '{}')
  console.log('[bubble fr detail]', JSON.stringify(report.bubbleFr, null, 1).slice(0, 1200))
}

// B. popup 元素定位（uiLang=en）
await swEval(`(async () => {
  const KEY = 'tv:config_v1';
  const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  cur.uiLang = 'en';
  await chrome.storage.local.set({ [KEY]: cur });
  return 'ok';
})()`)
{
  const { targetId: pid } = await br.send('Target.createTarget', { url: `${EXT}/popup.html` })
  await sleep(2500)
  const { sessionId: sid2 } = await br.send('Target.attachToTarget', { targetId: pid, flatten: true })
  await br.send('Runtime.enable', {}, sid2)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify((function(){
      var out = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        var txt = walker.currentNode.textContent.trim();
        if (/[\\u4e00-\\u9fff]/.test(txt)) {
          var el = walker.currentNode.parentElement;
          out.push({ text: txt.slice(0, 30), tag: el.tagName, cls: (el.className || '').toString().slice(0, 60) });
        }
      }
      return out;
    })()))()`,
    returnByValue: true,
  }, sid2)
  report.popupElements = JSON.parse(r.result?.value || '[]')
  console.log('[popup elements]', JSON.stringify(report.popupElements, null, 1))
  await br.send('Target.closeTarget', { targetId: pid }).catch(() => {})
}

// C. files 页明细（en UI）
{
  const { targetId: fid } = await br.send('Target.createTarget', { url: `${EXT}/files.html` })
  await sleep(2500)
  const { sessionId: sid3 } = await br.send('Target.attachToTarget', { targetId: fid, flatten: true })
  await br.send('Runtime.enable', {}, sid3)
  const r = await br.send('Runtime.evaluate', {
    expression: `(() => JSON.stringify(document.body.innerText.split('\\n').filter(function(l){return /[\\u4e00-\\u9fff]/.test(l);}).slice(0, 40)))()`,
    returnByValue: true,
  }, sid3)
  report.filesCjk = JSON.parse(r.result?.value || '[]')
  console.log('[files CJK]', report.filesCjk.join(' | ').slice(0, 400))
  await br.send('Target.closeTarget', { targetId: fid }).catch(() => {})
}

// D. styles.ts 样式名提取（源码侧证据）
report.styleNamesSource = '见 docs/i18n-audit-report.md 静态清单'

writeFileSync(join(OUT, 'audit-data2.json'), JSON.stringify(report, null, 1))
console.log('\nAUDIT2 DONE')
process.exit(0)
