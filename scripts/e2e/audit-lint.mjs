// 程序化视觉审查：溢出、对比度、圆角/字号一致性、控件尺寸、状态完整性
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

const LINT = `(() => {
  const issues = [];
  const radii = new Map(); const fontSizes = new Map(); const shadows = new Map();
  const parseRgb = (s) => { const m = s.match(/[\\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
  const luminance = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const effBg = (el) => { let cur = el; while (cur) { const bg = getComputedStyle(cur).backgroundColor; const rgb = parseRgb(bg); const alpha = parseFloat((bg.match(/[\\d.]+/g) || [])[3] ?? '1'); if (rgb && alpha > 0.9) return rgb; cur = cur.parentElement; } return [255, 255, 255]; };
  const els = [...document.querySelectorAll('body *')];
  for (const el of els) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // 溢出
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && !['HTML', 'BODY'].includes(el.tagName)) {
      issues.push({ type: 'overflow-x', sel: el.tagName + '.' + String(el.className).split(' ')[0], w: el.scrollWidth + '>' + el.clientWidth });
    }
    // 文本对比度
    const text = (el.textContent || '').trim();
    if (text && el.children.length === 0 && text.length < 200) {
      const fg = parseRgb(cs.color);
      if (fg) {
        const ratio = contrast(fg, effBg(el));
        if (ratio < 4.5 && parseFloat(cs.fontSize) < 18) {
          issues.push({ type: 'contrast', sel: el.tagName + '.' + String(el.className).split(' ')[0], ratio: ratio.toFixed(2), color: cs.color, text: text.slice(0, 24) });
        }
      }
    }
    // 控件高度
    if (['BUTTON', 'SELECT', 'INPUT'].includes(el.tagName) && rect.height < 24 && rect.height > 0) {
      issues.push({ type: 'small-control', sel: el.tagName + '.' + String(el.className).split(' ')[0], h: Math.round(rect.height) });
    }
    if (cs.borderRadius && cs.borderRadius !== '0px') radii.set(cs.borderRadius, (radii.get(cs.borderRadius) ?? 0) + 1);
    fontSizes.set(cs.fontSize, (fontSizes.get(cs.fontSize) ?? 0) + 1);
    if (cs.boxShadow !== 'none') shadows.set(cs.boxShadow.slice(0, 60), (shadows.get(cs.boxShadow.slice(0, 60)) ?? 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    issueCount: issues.length,
    issues: issues.slice(0, 25),
    radii: top(radii), fontSizes: top(fontSizes), shadows: top(shadows),
    viewport: { w: innerWidth, h: innerHeight },
    scrollOverflow: document.documentElement.scrollWidth > innerWidth,
  };
})()`

const v = await (await fetch(CDP + '/json/version')).json()
const br = await mk(v.webSocketDebuggerUrl)
async function newTab(url) {
  const { targetId } = await br.send('Target.createTarget', { url })
  let info = null
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    const list = await (await fetch(CDP + '/json/list')).json()
    info = list.find((x) => x.id === targetId)
    if (info) break
  }
  const c = await mk(info.webSocketDebuggerUrl)
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  return { c, targetId }
}

const pages = [
  ['popup', `${EXT}/popup.html`],
  ['options-general', `${EXT}/options.html`],
  ['options-experts', `${EXT}/options.html`, '专家'],
  ['options-style', `${EXT}/options.html`, '译文样式'],
  ['options-glossaryLibs', `${EXT}/options.html`, '术语库'],
  ['options-writing', `${EXT}/options.html`, 'AI 写作'],
  ['options-words', `${EXT}/options.html`, '生词本'],
  ['review', `${EXT}/review.html`],
  ['files', `${EXT}/files.html`],
]
const report = {}
for (const [name, url, tabLabel] of pages) {
  const { c, targetId } = await newTab(url)
  await sleep(1800)
  if (tabLabel) {
    await c.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.nav-btn')].find(b => b.textContent.includes('${tabLabel}'))?.click()`, returnByValue: true })
    await sleep(700)
  }
  const r = await c.send('Runtime.evaluate', { expression: LINT, returnByValue: true })
  report[name] = r.result?.value ?? { error: JSON.stringify(r).slice(0, 200) }
  await br.send('Target.closeTarget', { targetId })
}
console.log(JSON.stringify(report, null, 1))
process.exit(0)
