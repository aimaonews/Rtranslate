// 划词翻译：选区气泡（翻译 / AI 解析 / AI 写作 / 收藏生词 / 朗读 / 复制）。
import type { Config } from '../shared/config'
import type { AiAssistAction, AiChatMessage, AiWriteAction, BgResponse } from '../shared/protocol'
import { langName } from '../core/langs'
import { TtsPlayer } from './tts'

let popup: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let currentConfig: Config | null = null

// 朗读播放器单例：跨气泡共享，重复朗读自动中断旧播放
const ttsPlayer = new TtsPlayer()

export function setSelectionConfig(config: Config) {
  currentConfig = config
}

async function bg<T>(msg: unknown): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(msg)) as BgResponse<T>
  if (!resp.ok) throw new Error(resp.error)
  return resp.data
}

function toast(text: string) {
  document.querySelectorAll('.tv-sel-toast').forEach((n) => n.remove())
  const t = document.createElement('div')
  t.className = 'tv-sel-toast'
  t.setAttribute('data-tv-owned', '1')
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 1600)
}

function removePopup() {
  popup?.remove()
  popup = null
}

function getSelectionText(): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return ''
  return sel.toString().trim()
}

function contextAroundSelection(text: string): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return text.slice(0, 160)
  const node = sel.anchorNode
  const block = node?.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, blockquote, div')
  const blockText = block?.textContent ?? text
  const idx = blockText.indexOf(text)
  if (idx < 0) return blockText.slice(0, 160)
  return blockText.slice(Math.max(0, idx - 60), idx + text.length + 60)
}

/** 朗读/停止切换：参数取 config.tts，长文本由 TtsPlayer 按句切分连播。 */
function toggleSpeak(text: string, config: Config): void {
  if (ttsPlayer.isPlaying()) {
    ttsPlayer.stop()
    return
  }
  try {
    ttsPlayer.speak(text, {
      rate: config.tts.rate,
      pitch: config.tts.pitch,
      volume: config.tts.volume,
    })
    if (!ttsPlayer.isPlaying()) toast('朗读不可用')
  } catch {
    toast('朗读不可用')
  }
}

// ===== AI 写作面板（5 动作 + 语气/篇幅偏好） =====

const WRITE_ACTIONS: ReadonlyArray<{ id: AiWriteAction; label: string }> = [
  { id: 'polish', label: '润色' },
  { id: 'continue', label: '续写' },
  { id: 'summarize', label: '总结' },
  { id: 'reply', label: '回复' },
  { id: 'translate', label: '翻译' },
]

const WRITE_TONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'default', label: '语气：默认' },
  { value: 'formal', label: '语气：正式' },
  { value: 'casual', label: '语气：随意' },
  { value: 'humorous', label: '语气：幽默' },
  { value: 'professional', label: '语气：专业' },
]

const WRITE_LENGTHS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'default', label: '篇幅：默认' },
  { value: 'shorter', label: '篇幅：更短' },
  { value: 'longer', label: '篇幅：更长' },
]

// 与 options/tabWriting.ts 共享的存储键（默认语气/篇幅；shared/* 由主代理接线，暂不入 config）
const WRITING_PREFS_KEY = 'tv:writing_prefs_v1'

let writeTone = 'default'
let writeLength = 'default'
let writePrefsLoaded = false

/** 读取设置页保存的默认语气/篇幅，并同步到已打开的下拉。 */
function loadWritePrefs(): void {
  if (writePrefsLoaded) return
  writePrefsLoaded = true
  try {
    chrome.storage.local.get(WRITING_PREFS_KEY, (res) => {
      if (chrome.runtime.lastError) return
      const prefs = res?.[WRITING_PREFS_KEY] as { tone?: string; length?: string } | undefined
      if (typeof prefs?.tone === 'string') writeTone = prefs.tone
      if (typeof prefs?.length === 'string') writeLength = prefs.length
      document
        .querySelectorAll<HTMLSelectElement>('.tv-sel-write-tone')
        .forEach((s) => (s.value = writeTone))
      document
        .querySelectorAll<HTMLSelectElement>('.tv-sel-write-length')
        .forEach((s) => (s.value = writeLength))
    })
  } catch {
    // storage 不可用时保持默认
  }
}

function buildPopup(text: string, rect: DOMRect) {
  removePopup()
  const config = currentConfig!
  // 捕获当前选区 Range：点击气泡按钮后页面选区可能塌陷，"替换选区"前需恢复
  const selNow = window.getSelection()
  const savedRange = selNow && selNow.rangeCount > 0 ? selNow.getRangeAt(0).cloneRange() : null
  popup = document.createElement('div')
  popup.className = 'tv-sel-popup'
  popup.setAttribute('data-tv-owned', '1')
  popup.setAttribute('translate', 'no')

  const source = document.createElement('div')
  source.className = 'tv-sel-source'
  source.textContent = text.length > 120 ? text.slice(0, 120) + '…' : text
  popup.appendChild(source)

  const translation = document.createElement('div')
  translation.className = 'tv-sel-translation'
  translation.textContent = '翻译中…'
  popup.appendChild(translation)

  const actions = document.createElement('div')
  actions.className = 'tv-sel-actions'
  popup.appendChild(actions)

  const aiBox = document.createElement('div')
  aiBox.className = 'tv-sel-ai'
  aiBox.style.display = 'none'
  popup!.appendChild(aiBox)

  // ===== AI 写作面板（懒构建，复用 tv-sel-ai 样式容器） =====
  const writeBox = document.createElement('div')
  writeBox.className = 'tv-sel-ai'
  writeBox.style.display = 'none'
  popup.appendChild(writeBox)

  let writePanelBuilt = false
  let writeResult = ''

  /** 用生成结果替换当前选区；选区不可编辑时返回 false。 */
  const replaceSelection = (newText: string): boolean => {
    try {
      const sel = window.getSelection()
      if (sel && savedRange) {
        sel.removeAllRanges()
        sel.addRange(savedRange)
      }
      return document.execCommand('insertText', false, newText)
    } catch {
      return false
    }
  }

  const buildWritePanel = () => {
    if (writePanelBuilt) return
    writePanelBuilt = true
    loadWritePrefs()

    const actionRow = document.createElement('div')
    actionRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;'
    const prefRow = document.createElement('div')
    prefRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;'
    const resultBox = document.createElement('div')
    resultBox.style.cssText = 'white-space:pre-wrap;word-break:break-word;'
    resultBox.textContent = '选择上方动作开始。'
    const resultActions = document.createElement('div')
    resultActions.style.cssText = 'display:none;gap:4px;margin-top:6px;'
    writeBox.append(actionRow, prefRow, resultBox, resultActions)

    const mkSelect = (
      cls: string,
      options: ReadonlyArray<{ value: string; label: string }>,
      current: string,
      onChange: (v: string) => void,
    ): HTMLSelectElement => {
      const sel = document.createElement('select')
      sel.className = cls
      sel.style.cssText = 'font:11px var(--tv-font);flex:1;min-width:0;'
      for (const o of options) {
        const opt = document.createElement('option')
        opt.value = o.value
        opt.textContent = o.label
        sel.appendChild(opt)
      }
      sel.value = current
      sel.addEventListener('change', () => onChange(sel.value))
      sel.addEventListener('click', (e) => e.stopPropagation())
      return sel
    }
    prefRow.append(
      mkSelect('tv-sel-write-tone', WRITE_TONES, writeTone, (v) => (writeTone = v)),
      mkSelect('tv-sel-write-length', WRITE_LENGTHS, writeLength, (v) => (writeLength = v)),
    )

    const runWrite = (action: AiWriteAction) => {
      resultBox.textContent = '生成中…'
      resultActions.style.display = 'none'
      bg<string>({
        kind: 'aiWrite',
        action,
        text,
        tone: writeTone,
        length: writeLength,
        targetLang: config.general.targetLang,
      })
        .then((r) => {
          writeResult = r
          resultBox.textContent = r
          resultActions.style.display = 'flex'
        })
        .catch((e: Error) => {
          resultBox.textContent = `失败：${e.message}`
        })
    }

    for (const a of WRITE_ACTIONS) {
      const b = document.createElement('button')
      b.className = 'tv-sel-btn'
      b.textContent = a.label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        runWrite(a.id)
      })
      actionRow.appendChild(b)
    }

    const copyBtn = document.createElement('button')
    copyBtn.className = 'tv-sel-btn'
    copyBtn.textContent = '复制'
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      navigator.clipboard.writeText(writeResult).then(
        () => toast('已复制'),
        () => toast('复制失败'),
      )
    })
    const replaceBtn = document.createElement('button')
    replaceBtn.className = 'tv-sel-btn tv-sel-primary'
    replaceBtn.textContent = '替换选区'
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (replaceSelection(writeResult)) {
        toast('已替换选区')
        removePopup()
      } else {
        // 选区不可编辑（普通网页文本）：退化为复制
        navigator.clipboard.writeText(writeResult).then(
          () => toast('选区不可编辑，已复制到剪贴板'),
          () => toast('替换失败'),
        )
      }
    })
    resultActions.append(copyBtn, replaceBtn)
  }

  const addBtn = (label: string, onClick: () => void, primary = false) => {
    const b = document.createElement('button')
    b.className = 'tv-sel-btn' + (primary ? ' tv-sel-primary' : '')
    b.textContent = label
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
    actions.appendChild(b)
    return b
  }

  // 自动翻译
  bg<string>({ kind: 'translate', text, targetLang: config.general.targetLang })
    .then((r: string) => {
      // translate 返回 {text,...} 结构
      translation.textContent = (r as unknown as { text: string }).text ?? String(r)
    })
    .catch((err: Error) => {
      translation.textContent = `翻译失败：${err.message}`
    })

  // ===== AI 阅读卡片（四动作解析 + 多轮追问，重灾区 #5） =====
  let aiPanelBuilt = false

  const buildAiPanel = () => {
    if (aiPanelBuilt) return
    aiPanelBuilt = true
    const pageContext = contextAroundSelection(text)

    const resultBox = document.createElement('div')
    resultBox.style.cssText = 'white-space:pre-wrap;word-break:break-word;'
    resultBox.textContent = '思考中…'

    const chatList = document.createElement('div')
    chatList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;'

    const inputRow = document.createElement('div')
    inputRow.style.cssText = 'display:flex;gap:4px;margin-top:8px;'
    const followInput = document.createElement('input')
    followInput.type = 'text'
    followInput.placeholder = '追问：用法 / 近义词 / 更多例句…'
    followInput.style.cssText =
      'flex:1;min-width:0;font:12px var(--tv-font);padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;'
    const sendBtn = document.createElement('button')
    sendBtn.className = 'tv-sel-btn tv-sel-primary'
    sendBtn.textContent = '发送'
    inputRow.append(followInput, sendBtn)
    aiBox.append(resultBox, chatList, inputRow)

    // 对话历史：首条 user = 选中内容+上下文+初始问题，assistant = 首轮回答，之后交替
    const history: AiChatMessage[] = []
    let ready = false
    let sending = false

    const appendBubble = (role: 'user' | 'assistant', content: string) => {
      const b = document.createElement('div')
      b.style.cssText =
        'white-space:pre-wrap;word-break:break-word;font-size:12px;padding:6px 8px;border-radius:8px;max-width:92%;' +
        (role === 'user'
          ? 'align-self:flex-end;background:#2563eb;color:#fff;'
          : 'align-self:flex-start;background:#e2e8f0;color:#1e293b;')
      b.textContent = content
      chatList.appendChild(b)
      b.scrollIntoView({ block: 'nearest' })
    }

    const sendFollowUp = () => {
      const q = followInput.value.trim()
      if (!q || sending) return
      if (!ready) {
        toast('首轮解析进行中，请稍候')
        return
      }
      followInput.value = ''
      appendBubble('user', q)
      history.push({ role: 'user', content: q })
      sending = true
      sendBtn.disabled = true
      bg<string>({ kind: 'aiChat', messages: history })
        .then((reply) => {
          history.push({ role: 'assistant', content: reply })
          appendBubble('assistant', reply)
        })
        .catch((e: Error) => {
          appendBubble('assistant', `（请求失败：${e.message}）`)
        })
        .finally(() => {
          sending = false
          sendBtn.disabled = false
          followInput.focus()
        })
    }
    followInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        sendFollowUp()
      }
    })
    followInput.addEventListener('click', (e) => e.stopPropagation())
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      sendFollowUp()
    })

    // 首轮：四动作并行解析（带页面上下文注入）
    const actions4: AiAssistAction[] = ['meaning', 'grammar', 'usage', 'practice']
    Promise.all(
      actions4.map((a) =>
        bg<string>({
          kind: 'aiAssist',
          action: a,
          text,
          context: pageContext,
          targetLang: config.general.targetLang,
        }).catch((e: Error) => `（${a} 不可用：${e.message}）`),
      ),
    ).then((parts) => {
      const combined = parts.join('\n\n')
      resultBox.textContent = combined
      history.push({
        role: 'user',
        content:
          `选中内容：${text}\n` +
          `页面上下文：${pageContext}\n` +
          `初始问题：请给出以上选中内容的释义、语法分析、用法讲解与随堂练习，` +
          `并始终用${langName(config.general.targetLang, 'zh')}回答。`,
      })
      history.push({ role: 'assistant', content: combined })
      ready = true
    })
  }

  addBtn('AI 解析', () => {
    aiBox.style.display = aiBox.style.display === 'none' ? 'block' : 'none'
    if (aiBox.style.display === 'block') buildAiPanel()
  })
  if (config.writing.enabled) {
    addBtn('✍ 写作', () => {
      writeBox.style.display = writeBox.style.display === 'none' ? 'block' : 'none'
      if (writeBox.style.display === 'block') buildWritePanel()
    })
  }
  if (config.learning.enabled) {
    addBtn('☆ 收藏', async () => {
      try {
        await bg({
          kind: 'saveWord',
          word: text,
          context: contextAroundSelection(text),
          pageUrl: location.href,
          pageTitle: document.title,
        })
        toast('已加入生词本')
      } catch (e) {
        toast(`收藏失败：${(e as Error).message}`)
      }
    })
  }
  // 朗读：播放中按钮变「停止」，再点停止；自然播完自动还原
  const speakBtn = addBtn(ttsPlayer.isPlaying() ? '停止' : '朗读', () => toggleSpeak(text, config))
  ttsPlayer.onStateChange = (playing) => {
    speakBtn.textContent = playing ? '停止' : '朗读'
  }
  addBtn('复制', async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制')
    } catch {
      toast('复制失败')
    }
  })
  addBtn('关闭', () => removePopup())

  // 定位：优先选区下方，越界则上方
  const pad = 8
  popup.style.visibility = 'hidden'
  document.body.appendChild(popup)
  const ph = popup.offsetHeight
  const pw = popup.offsetWidth
  let top = rect.bottom + pad + window.scrollY
  if (rect.bottom + ph + pad > window.innerHeight) top = rect.top - ph - pad + window.scrollY
  let left = rect.left + window.scrollX
  left = Math.max(4, Math.min(left, window.scrollX + window.innerWidth - pw - 4))
  popup.style.top = `${Math.max(4, top)}px`
  popup.style.left = `${left}px`
  popup.style.visibility = 'visible'
}

export function initSelection(config: Config) {
  currentConfig = config
  let timer: ReturnType<typeof setTimeout> | null = null
  document.addEventListener('selectionchange', () => {
    if (!currentConfig?.selection.enabled) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (popup?.matches(':hover')) return // 用户正在操作气泡
      const text = getSelectionText()
      const minLen = 1
      if (text.length < minLen || text.length > currentConfig!.selection.maxChars) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.anchorNode
      if (node instanceof Element && node.closest('[data-tv-owned]')) return
      if (node?.parentElement?.closest('[data-tv-owned]')) return
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect.width && !rect.height) return
      buildPopup(text, rect)
    }, 220)
  })
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target as Node)) removePopup()
  })
  window.addEventListener('scroll', () => {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(removePopup, 150) // 滚动防抖隐藏，避免定位漂移
  }, { passive: true })
}
