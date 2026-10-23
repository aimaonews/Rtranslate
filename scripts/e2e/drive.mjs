// TransVerse 端到端测试驱动：通过 CDP 驱动加载了 dist 扩展的 Edge。
// 阶段 A: 整页翻译  B: 划词气泡  C: 输入框翻译  D: 敏感信息脱敏还原  E: 生词本+FSRS  F: 复习页
import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const PAGE_URL = 'http://127.0.0.1:8137/test-page.html'
const summary = { phases: {}, errors: [] }

async function targets() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(CDP + '/json/list')
      return await r.json()
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('CDP not reachable')
}

function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.onopen = () => resolve({
      send: (method, params = {}, sessionId) =>
        new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify(sessionId ? { id: mid, method, params, sessionId } : { id: mid, method, params }))
        }),
      close: () => ws.close(),
    })
    ws.onerror = (e) => reject(e)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      } else if (!msg.id && onEvent) {
        onEvent(msg)
      }
    }
  })
}

/** 在页面连接上找到内容脚本（扩展隔离世界）的 executionContextId */
async function findExtContext(pgC, contexts) {
  for (let i = 0; i < 25; i++) {
    const ctx = contexts.find((c) => c.origin.startsWith('chrome-extension://'))
    if (ctx) return ctx.id
    await sleep(400)
  }
  throw new Error('content script execution context not found')
}

async function evaluate(client, expression, opts = {}) {
  const { sessionId, ...rest } = opts
  const r = await client.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, ...rest,
  }, sessionId)
  if (r.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400))
  }
  return r.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await targets()
  const page = list.find((t) => t.type === 'page' && t.url.startsWith(PAGE_URL))
  if (!page) throw new Error('test page not found: ' + JSON.stringify(list.map((t) => t.type + ':' + t.url)))

  const pgContexts = []
  const pgC = await connect(page.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Runtime.executionContextCreated') pgContexts.push(msg.params.context)
    if (msg.method === 'Runtime.executionContextDestroyed') {
      const i = pgContexts.findIndex((c) => c.id === msg.params.executionContextId)
      if (i >= 0) pgContexts.splice(i, 1)
    }
  })
  await pgC.send('Runtime.enable')
  await pgC.send('Page.enable')
  // 启动 URL 在扩展就绪前加载，内容脚本可能未注入，强制重载一次
  await pgC.send('Page.reload', { ignoreCache: true })
  await sleep(3500)

  // SW 空闲时会从目标列表消失：轮询浏览器端点直到 service worker 出现（内容脚本 getConfig 会唤醒它）
  const version = await (await fetch(CDP + '/json/version')).json()
  const brC = await connect(version.webSocketDebuggerUrl)
  let swInfo = null
  for (let i = 0; i < 30; i++) {
    const t = await brC.send('Target.getTargets')
    swInfo = t.targetInfos.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
    if (swInfo) break
    await sleep(600)
  }
  brC.close()
  if (!swInfo) throw new Error('service worker never appeared')
  const version2 = await (await fetch(CDP + '/json/version')).json()
  const swC = await connect(version2.webSocketDebuggerUrl)
  const { sessionId } = await swC.send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true })
  await swC.send('Runtime.enable', {}, sessionId)

  const swEval = (expr) => evaluate(swC, expr, { sessionId })
  const pgEval = (expr) => evaluate(pgC, expr)
  const pgEvalIn = (expr, contextId) => evaluate(pgC, expr, { contextId })

  // ===== Phase A: 整页双语翻译 =====
  // 注：无 <all_urls> 后 tabs.query 不能按 URL 过滤（合规设计），用当前活动标签页
  const phaseA = await swEval(`(async () => {
    // 缩短超时让免费链降级更快（测试环境 google 不可达时快速落到 mymemory）
    const cur = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'] ?? {};
    await chrome.storage.local.set({ 'tv:config_v1': { ...cur, engine: { ...(cur.engine ?? {}), timeoutMs: 8000 } } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { error: 'no tab' };
    await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' });
    await new Promise(r => setTimeout(r, 30000));
    const state = await chrome.tabs.sendMessage(tab.id, { kind: 'pageState' }).catch(e => ({ error: String(e) }));
    return { state };
  })()`)
  const pageA = await pgEval(`(() => {
    const trs = [...document.querySelectorAll('tv-translation')];
    return {
      count: trs.length,
      samples: trs.slice(0, 3).map(t => t.innerText.replace(/\\s+/g, ' ').slice(0, 90)),
      errorBoxes: [...document.querySelectorAll('.tv-error')].map(e => e.textContent.slice(0, 80)).slice(0, 3),
      ball: !!document.querySelector('.tv-ball'),
    };
  })()`)
  summary.phases.A = { ...phaseA, ...pageA }

  // ===== Phase B: 划词翻译气泡 =====
  summary.phases.B = await pgEval(`(async () => {
    const p = document.querySelectorAll('p')[1];
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise(r => setTimeout(r, 20000));
    const pop = document.querySelector('.tv-sel-popup');
    return {
      popupExists: !!pop,
      translation: pop ? (pop.querySelector('.tv-sel-translation')?.textContent ?? '').slice(0, 120) : null,
      buttons: pop ? [...pop.querySelectorAll('.tv-sel-btn')].map(b => b.textContent) : [],
    };
  })()`)

  // ===== Phase C: 输入框翻译（中文 → 英文）=====
  summary.phases.C = await pgEval(`(async () => {
    const ta = document.getElementById('e2e-input');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 20000));
    return { value: ta.value.slice(0, 120) };
  })()`)

  // ===== Phase D: 敏感信息脱敏（邮箱/电话须在译文中还原）=====
  // SW 可直接读写 chrome.storage（绕开"SW 不能给自己发消息"的限制），内容脚本经 storage 热同步
  await swEval(`(async () => {
    const cur = (await chrome.storage.local.get('tv:config_v1'))['tv:config_v1'] ?? {};
    await chrome.storage.local.set({ 'tv:config_v1': { ...cur, mask: { enabled: true } } });
    await chrome.storage.local.remove('tv:cache_v1');
    return true;
  })()`)
  await pgEval(`location.reload(), true`)
  await sleep(3500)
  summary.phases.D = await swEval(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // 重载后内容脚本需要重建连接，重试直到就绪
    for (let i = 0; i < 25; i++) {
      try { await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' }); break; }
      catch { await new Promise(r => setTimeout(r, 800)); }
    }
    await new Promise(r => setTimeout(r, 30000));
    return await chrome.tabs.sendMessage(tab.id, { kind: 'pageState' }).catch(e => ({ error: String(e) }));
  })()`).then(async (s) => {
    const emailCheck = await pgEval(`(() => {
      const trs = [...document.querySelectorAll('tv-translation')];
      const emailTr = trs.find(t => t.innerText.includes('john.doe@example.com'));
      const phoneTr = trs.find(t => /138.*1234.*5678/.test(t.innerText));
      return { restoredEmail: !!emailTr, restoredPhone: !!phoneTr, emailText: emailTr ? emailTr.innerText.slice(0, 120) : null };
    })()`)
    return { ...s, ...emailCheck }
  })

  // ===== Phase E+F: 生词本 + FSRS（在扩展页 review.html 的 extension world 里发消息）与复习页渲染 =====
  await swEval(`(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }); return true; })()`)
  await sleep(2500)
  const list2 = await targets()
  const reviewTab = list2.find((t) => t.type === 'page' && t.url.includes('review.html'))
  if (!reviewTab) throw new Error('review tab not found')

  summary.phases.E = await (async () => {
    const rvC = await connect(reviewTab.webSocketDebuggerUrl)
    await rvC.send('Runtime.enable')
    const rvEval = (expr) => evaluate(rvC, expr)
    const result = await rvEval(`(async () => {
      const send = (m) => chrome.runtime.sendMessage(m).then(r => { if (!r.ok) throw new Error(r.error); return r.data; });
      const word = await send({ kind: 'saveWord', word: 'deliberately', context: 'doing less, more deliberately' });
      const stats1 = await send({ kind: 'getStats' });
      const before = word.card.due;
      await send({ kind: 'reviewGrade', wordId: word.id, rating: 3 });
      const words = await send({ kind: 'getWords' });
      const updated = words.find(w => w.id === word.id);
      return { saved: word.word, state: word.card.state, stats1, dueChanged: updated.card.due !== before, afterState: updated.card.state, reps: updated.card.reps };
    })()`)
    rvC.close()
    return result
  })()

  // ===== Phase F: 复习页 UI（刷新一次让 E 保存的词进入队列）=====
  await sleep(1500)
  const list3 = await targets()
  const reviewTab2 = list3.find((t) => t.type === 'page' && t.url.includes('review.html'))
  const rvC2 = await connect(reviewTab2.webSocketDebuggerUrl)
  await rvC2.send('Runtime.enable')
  await rvC2.send('Page.enable')
  await rvC2.send('Page.reload')
  await sleep(2500)
  summary.phases.F = await evaluate(rvC2, `(() => ({
    title: document.title,
    hasContent: document.body.innerText.length > 10,
    snippet: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160),
    gradeButtons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 8),
  }))()`)
  rvC2.close()

  swC.close()
  pgC.close()
  console.log(JSON.stringify(summary, null, 2))
  writeFileSync(new URL('./e2e-result.json', import.meta.url), JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  summary.errors.push(String(e.stack ?? e))
  console.log(JSON.stringify(summary, null, 2))
  process.exit(1)
})
