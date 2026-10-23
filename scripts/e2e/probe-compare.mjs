// 验证 Alt+D 对比窗：派发 tv:compare 事件 → 检查浮层与引擎卡片
const CDP = 'http://127.0.0.1:9222'
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
const list = await (await fetch(CDP + '/json/list')).json()
const pg = list.find((t) => t.type === 'page' && t.url.includes('8137'))
const c = await mk(pg.webSocketDebuggerUrl)
await c.send('Runtime.enable')

// 选中一段文本再派发对比事件
const r = await c.send('Runtime.evaluate', {
  expression: `(async () => {
    const p = document.querySelectorAll('p')[1];
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new CustomEvent('tv:compare'));
    await new Promise(r => setTimeout(r, 1200));
    const host = document.querySelector('[data-tv-owned]')?.shadowRoot ?? null;
    // 对比窗是 shadow DOM，从 document 找宿主
    let panel = null;
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot && el.shadowRoot.querySelector('.tv-compare-panel, [class*="compare"]')) { panel = el; break; }
    }
    if (!panel) return { found: false };
    const cards = [...panel.shadowRoot.querySelectorAll('[class*="card"], [class*="engine"]')].map(x => x.textContent.replace(/\\s+/g, ' ').slice(0, 80));
    await new Promise(r => setTimeout(r, 15000));
    const cardsAfter = [...panel.shadowRoot.querySelectorAll('[class*="card"], [class*="engine"]')].map(x => x.textContent.replace(/\\s+/g, ' ').slice(0, 100));
    return { found: true, cardsInitial: cards, cardsAfter };
  })()`,
  awaitPromise: true,
  returnByValue: true,
})
console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description, null, 1))
process.exit(0)
