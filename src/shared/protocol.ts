import type { Config } from './config'

// ===== content / popup → background =====
export type BgRequest =
  | { kind: 'translate'; text: string; targetLang: string; sourceLang?: string; context?: string }
  | { kind: 'translateBatch'; texts: string[]; targetLang: string; sourceLang?: string }
  | { kind: 'detectLang'; text: string }
  | { kind: 'aiAssist'; action: AiAssistAction; text: string; targetLang: string; context?: string }
  | { kind: 'aiChat'; messages: AiChatMessage[] }
  | { kind: 'aiWrite'; action: AiWriteAction; text: string; tone?: string; length?: string; targetLang?: string }
  | { kind: 'extractTerms'; text: string; targetLang: string }
  | { kind: 'compareTranslate'; text: string; targetLang: string; engineIds: string[] }
  | { kind: 'getConfig' }
  | { kind: 'setConfig'; patch: Partial<Config> }
  | { kind: 'saveWord'; word: string; context?: string; translation?: string; pageUrl?: string; pageTitle?: string }
  | { kind: 'deleteWord'; id: string }
  | { kind: 'getWords' }
  | { kind: 'reviewGrade'; wordId: string; rating: 1 | 2 | 3 | 4 }
  | { kind: 'getStats' }
  | { kind: 'testEngine' }
  | { kind: 'setBadge'; active: boolean }
  | { kind: 'command'; cmd: 'togglePage' | 'openOptions' | 'openReview' | 'openFiles' }

export type AiAssistAction = 'meaning' | 'grammar' | 'usage' | 'practice'
export type AiWriteAction = 'polish' | 'continue' | 'summarize' | 'reply' | 'translate'

/** AI 阅读卡片多轮追问的对话消息（首条 user 含选中内容+页面上下文，之后交替）。 */
export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 统一响应：失败用 ok:false 返回，绝不 reject */
export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

export interface TranslateResult {
  text: string
  detectedLang?: string
  engine?: string
}

export interface WordItem {
  id: string
  word: string
  context?: string
  translation?: string
  sourceLang?: string
  targetLang?: string
  note?: string
  /** 生词来源页面 URL（划词收藏时取 location.href） */
  pageUrl?: string
  /** 生词来源页面标题（划词收藏时取 document.title） */
  pageTitle?: string
  createdAt: number
  seenCount: number
  card: {
    due: number
    stability: number
    difficulty: number
    elapsed_days: number
    scheduled_days: number
    reps: number
    lapses: number
    state: number
    learning_steps?: number
    last_review?: number
  }
}

export interface StatsResult {
  dueCount: number
  totalWords: number
  newCount: number
  translatedChars: number
}

/** kind:'testEngine' 的 data：用当前配置引擎翻译 "Hello" 的连通性测试结果。失败原话在 error。 */
export interface TestEngineResult {
  ok: boolean
  /** 成功时的译文 */
  text?: string
  /** 当前配置的引擎 id */
  engine: string
  elapsedMs: number
  /** 失败时的错误原话 */
  error?: string
}

// ===== background / popup → content =====
export type ContentRequest =
  | { kind: 'togglePage' }
  | { kind: 'pageState' }
  | { kind: 'configChanged'; config: Config }

export interface PageStateResult {
  active: boolean
  translatedCount: number
  failedCount: number
  /** 当前页域名（popup 站点规则用） */
  host?: string
}

export function ok<T>(data: T): BgResponse<T> {
  return { ok: true, data }
}
export function err(error: unknown): BgResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}
