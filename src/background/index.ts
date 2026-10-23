// background 入口：消息总线、快捷键命令、右键菜单、生词本 FSRS 评分。
import { FSRS } from 'ts-fsrs'
import { translate, translateTexts, detectLang, aiAssist, aiChat } from './translate'
import { compareTranslate } from './compare'
import { aiWrite } from './aiWrite'
import { extractTermsWithAI } from './glossaryLibs'
import { syncCustomEngines } from './engines'
import { getConfig, setConfig, getWords, addWord, deleteWord, updateWord, toFsrsCard, toWordCard, watchConfig } from '../shared/store'
import { ok, err, type BgRequest, type BgResponse, type StatsResult, type TestEngineResult, type WordItem } from '../shared/protocol'

const fsrs = new FSRS({})

// SW 启动：用持久化配置重建 custom:<id> 动态引擎注册表
void getConfig().then(syncCustomEngines)

// 配置变化（options 页保存）→ 同步重建动态引擎
watchConfig(syncCustomEngines)

async function handle(msg: BgRequest, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  const config = await getConfig()
  syncCustomEngines(config)
  switch (msg.kind) {
    case 'translate': {
      const result = await translate(msg.text, { targetLang: msg.targetLang, sourceLang: msg.sourceLang, context: msg.context }, config)
      await setConfig({
        stats: { ...config.stats, translatedChars: config.stats.translatedChars + msg.text.length },
      })
      return result
    }
    case 'translateBatch': {
      const results = await translateTexts(msg.texts, { targetLang: msg.targetLang, sourceLang: msg.sourceLang }, config)
      const total = msg.texts.reduce((s, t) => s + t.length, 0)
      await setConfig({
        stats: { ...config.stats, translatedChars: config.stats.translatedChars + total },
      })
      return results
    }
    case 'detectLang':
      return { lang: await detectLang(msg.text, config) }
    case 'compareTranslate': {
      const results = await compareTranslate(msg.text, msg.targetLang, msg.engineIds, config)
      await setConfig({
        stats: { ...config.stats, translatedChars: config.stats.translatedChars + msg.text.length },
      })
      return results
    }
    case 'aiAssist':
      return { text: await aiAssist(msg.action, msg.text, msg.targetLang, config, msg.context) }
    case 'aiChat':
      return { text: await aiChat(msg.messages, config) }
    case 'aiWrite':
      return { text: await aiWrite(msg.action, msg.text, { tone: msg.tone, length: msg.length, targetLang: msg.targetLang }, config) }
    case 'extractTerms':
      return { terms: await extractTermsWithAI(msg.text, msg.targetLang, config) }
    case 'getConfig':
      return config
    case 'setConfig': {
      const next = await setConfig(msg.patch)
      return next
    }
    case 'saveWord':
      return addWord(msg)
    case 'deleteWord':
      await deleteWord(msg.id)
      return null
    case 'getWords':
      return getWords()
    case 'reviewGrade': {
      const words = await getWords()
      const word = words.find((w) => w.id === msg.wordId)
      if (!word) throw new Error('单词不存在')
      const scheduling = fsrs.repeat(toFsrsCard(word.card), new Date())
      const next = scheduling[msg.rating]
      if (!next) throw new Error('无效的评分')
      await updateWord(msg.wordId, (w) => ({ ...w, card: toWordCard(next.card) }))
      return { due: next.card.due.getTime() }
    }
    case 'getStats': {
      const words = await getWords()
      const now = Date.now()
      const dueCount = words.filter((w) => w.card.due <= now).length
      const newCount = words.filter((w) => w.card.state === 0).length
      const stats: StatsResult = {
        dueCount,
        newCount,
        totalWords: words.length,
        translatedChars: config.stats.translatedChars,
      }
      return stats
    }
    case 'testEngine': {
      // 连通性测试：复用 translate() 管线把 "Hello" 译到目标语言；失败返回错误原话（不抛出，让设置页原样展示）
      const started = Date.now()
      try {
        const result = await translate('Hello', { targetLang: config.general.targetLang }, config)
        const out: TestEngineResult = {
          ok: true,
          text: result.text,
          engine: config.engine.provider,
          elapsedMs: Date.now() - started,
        }
        return out
      } catch (e) {
        const out: TestEngineResult = {
          ok: false,
          engine: config.engine.provider,
          elapsedMs: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
        }
        return out
      }
    }
    case 'setBadge': {
      // 整页翻译开关角标：绿底 ✓ = 该标签页翻译中。无 tab 上下文（popup/options 发来）忽略
      const tabId = sender?.tab?.id
      if (tabId == null) return null
      if (msg.active) {
        await chrome.action.setBadgeBackgroundColor({ color: '#67c23a', tabId })
        await chrome.action.setBadgeText({ text: '✓', tabId })
      } else {
        await chrome.action.setBadgeText({ text: '', tabId })
      }
      return null
    }
    case 'command': {
      if (msg.cmd === 'togglePage') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
        return null
      }
      if (msg.cmd === 'openOptions') {
        await chrome.runtime.openOptionsPage()
        return null
      }
      const page = msg.cmd === 'openFiles' ? 'files.html' : 'review.html'
      const url = chrome.runtime.getURL(page)
      await chrome.tabs.create({ url })
      return null
    }
    default:
      throw new Error(`未知消息类型`)
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
  handle(msg, sender)
    .then((data) => sendResponse(ok(data)))
    .catch((e) => sendResponse(err(e)))
  return true // 保持异步通道
})

// 角标兜底清理：content 的 pagehide 上报是尽力而为，
// 导航（status=loading，文档重建后旧 content 已销毁）与关标签在此兜底。
function clearTabBadge(tabId: number) {
  // tab 可能已销毁，setBadgeText 会 reject，静默吞掉
  void chrome.action.setBadgeText({ text: '', tabId }).catch(() => {})
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') clearTabBadge(tabId)
})

chrome.tabs.onRemoved.addListener((tabId) => clearTabBadge(tabId))

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-translation') {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id != null) void chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
    })
  }
})

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: 'tv-toggle-page',
    title: chrome.i18n.getMessage('menuTogglePage') || '切换整页翻译 (Rtranslate)',
    contexts: ['page'],
  })
  chrome.contextMenus.create({
    id: 'tv-open-options',
    title: chrome.i18n.getMessage('menuOptions') || 'Rtranslate 设置',
    contexts: ['page'],
  })
  // 仅首次安装弹出引导页；update/chrome_update 一律不打扰
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html'), active: true })
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'tv-toggle-page' && tab?.id != null) {
    void chrome.tabs.sendMessage(tab.id, { kind: 'togglePage' })
  } else if (info.menuItemId === 'tv-open-options') {
    void chrome.runtime.openOptionsPage()
  }
})

// 类型锚定：避免 WordItem/BgResponse 未使用告警的同时保留导出形状
export type { WordItem, BgResponse }
