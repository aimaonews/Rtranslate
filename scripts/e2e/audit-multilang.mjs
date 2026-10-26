// 多语言 i18n 审计：
//  - 拉丁字母界面（en/de/es/fr/pt-BR/it）：全部页面查中文残留（白名单：语言下拉的原生语言名）
//  - CJK 界面（ja/zh-CN/zh-TW）：抽查 12 个 tab 标签与页面标题是否符合该语言
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

// 原生语言名白名单（语言下拉设计如此）
const NATIVE = ['简体中文', '繁體中文', '日本語', '한국어', 'English', 'Deutsch', 'Español', 'Français', 'Português']
function isNativeOnly(line) {
  let s = line.trim()
  for (const n of NATIVE) s = s.split(n).join(' ')
  return s.replace(/[\s,，、·()（）]/g, '').length === 0
}

const LATIN = ['en', 'de', 'es', 'fr', 'pt-BR', 'it']
const CJK_EXPECTED_TABS = {
  ja: ['一般', '翻訳エンジン', 'AI エキスパート', 'スタイル', 'プライバシー', '用語集', 'AI 用語ライブラリ', 'AI ライティング', '音声読み上げ', '単語帳', '操作', 'ショートカット'],
  'zh-CN': ['通用', '翻译引擎', 'AI 专家', '译文样式', '隐私', '术语表', 'AI 术语库', 'AI 写作', '语音朗读', '生词本', '交互', '快捷键'],
  'zh-TW': ['一般', '翻譯引擎', 'AI 專家', '譯文樣式', '隱私', '詞彙表', 'AI 詞彙庫', 'AI 寫作', '語音朗讀', '生字簿', '互動', '快速鍵'],
}
const TABS = ['general', 'engine', 'experts', 'style', 'privacy', 'glossary', 'glossaryLibs', 'writing', 'tts', 'words', 'interaction', 'hotkeys']
const report = {}

async function auditLang(lang) {
  await swEval(`(async () => {
    const KEY = 'tv:config_v1';
    const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
    cur.uiLang = '${lang}';
    await chrome.storage.local.set({ [KEY]: cur });
    return 'ok';
  })()`)
  const issues = []
  // 关旧扩展页，开 options
  const t = await br.send('Target.getTargets')
  for (const ti of t.targetInfos) if (ti.type === 'page' && ti.url.startsWith(EXT)) await br.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {})
  const { targetId } = await br.send('Target.createTarget', { url: `${EXT}/options.html` })
  await sleep(2800)
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true })
  await br.send('Runtime.enable', {}, sessionId)

  if (LATIN.includes(lang)) {
    for (const tab of TABS) {
      await br.send('Runtime.evaluate', { expression: `(function(){ var b = document.querySelector('[data-tab="${tab}"]'); if (b) b.click(); })()`, returnByValue: true }, sessionId)
      await sleep(600)
      const r = await br.send('Runtime.evaluate', {
        expression: `(() => JSON.stringify(document.body.innerText.split('\\n').filter(function(l){ return /[\\u4e00-\\u9fff]/.test(l); }).slice(0, 30)))()`,
        returnByValue: true,
      }, sessionId)
      const lines = JSON.parse(r.result?.value || '[]')
      const bad = lines.filter((l) => !isNativeOnly(l))
      if (bad.length) issues.push(`options.${tab}: ${bad.slice(0, 3).join(' | ').slice(0, 120)}`)
    }
  } else {
    // CJK 界面：抽查 12 个 tab 标签
    const r = await br.send('Runtime.evaluate', {
      expression: `(() => JSON.stringify(Array.from(document.querySelectorAll('.nav-btn')).map(function(b){ return b.textContent.trim(); })))()`,
      returnByValue: true,
    }, sessionId)
    const labels = JSON.parse(r.result?.value || '[]')
    const expected = CJK_EXPECTED_TABS[lang]
    for (let i = 0; i < expected.length; i++) {
      if (labels[i] !== expected[i]) issues.push(`tab[${i}] "${labels[i]}" ≠ "${expected[i]}"`)
    }
  }
  await br.send('Target.closeTarget', { targetId }).catch(() => {})

  // popup / onboarding / files / review
  for (const page of ['popup', 'onboarding', 'files', 'review']) {
    const { targetId: pid } = await br.send('Target.createTarget', { url: `${EXT}/${page}.html` })
    await sleep(2200)
    const { sessionId: sid } = await br.send('Target.attachToTarget', { targetId: pid, flatten: true })
    await br.send('Runtime.enable', {}, sid)
    const r = await br.send('Runtime.evaluate', {
      expression: `(() => JSON.stringify(document.body.innerText.split('\\n').filter(function(l){ return /[\\u4e00-\\u9fff]/.test(l); }).slice(0, 20)))()`,
      returnByValue: true,
    }, sid)
    const lines = JSON.parse(r.result?.value || '[]')
    if (LATIN.includes(lang)) {
      const bad = lines.filter((l) => !isNativeOnly(l))
      if (bad.length) issues.push(`${page}: ${bad.slice(0, 2).join(' | ').slice(0, 100)}`)
    } else {
      // CJK 界面：页面应有大量该语言文本（非空且非英文标题）
      const hasCJK = lines.length >= 2
      if (!hasCJK) issues.push(`${page}: 无 CJK 文本（疑似未本地化）`)
    }
    await br.send('Target.closeTarget', { targetId: pid }).catch(() => {})
  }
  return issues
}

for (const lang of [...LATIN, 'ja', 'zh-CN', 'zh-TW']) {
  const issues = await auditLang(lang)
  report[lang] = issues
  console.log(`[${lang}] ${issues.length === 0 ? 'PASS ✓' : issues.length + ' 项问题'}`)
  for (const x of issues.slice(0, 5)) console.log('    ', x)
}
const total = Object.values(report).reduce((n, a) => n + a.length, 0)
console.log('\nTOTAL issues:', total)
process.exit(0)
