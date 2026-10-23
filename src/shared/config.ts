// Config 契约：单一对象 + 读时归一化（normalizeConfig 白名单逐 key 拷贝，等价于隐式 schema 迁移）
import { BUILTIN_EXPERTS, type ExpertPreset } from '../core/experts'

export type { ExpertPreset }
export interface GlossaryTerm { src: string; dst: string }

/** 自定义术语库 */
/** 自定义翻译引擎（OpenAI 兼容协议，可多实例） */
export interface CustomEngine {
  id: string
  name: string
  endpoint: string
  apiKey: string
  model: string
  headersJson: string
}

export interface CustomGlossaryLibrary {
  id: string
  name: string
  terms: GlossaryTerm[]
}

export interface Config {
  version: 1
  general: {
    targetLang: string
    sourceLang: string
    displayMode: 'bilingual' | 'translationOnly'
    autoTranslateSites: string[]
    autoTranslateLangs: string[]
    neverTranslateSites: string[]
  }
  engine: {
    /** 内置引擎 id 或自定义引擎 id（custom:<entryId>） */
    provider: string
    keys: {
      deepl: string
      openai: string
      claude: string
      gemini: string
      libreUrl: string
      customHeadersJson: string
      aimao: string
    }
    openai: { endpoint: string; model: string }
    deepseek: { endpoint: string; model: string }
    claude: { model: string }
    gemini: { model: string }
    aimao: { model: string }
    customEngines: CustomEngine[]
    custom: { url: string; bodyJson: string }
    timeoutMs: number
  }
  batch: {
    enabled: boolean
    maxTexts: number
    maxChars: number
    intervalMs: number
    concurrency: number
  }
  style: { styleId: string }
  selection: { enabled: boolean; mode: 'bilingual' | 'translationOnly'; maxChars: number }
  hover: { enabled: boolean; key: 'alt' | 'ctrl' | 'shift' | 'none' }
  input: { enabled: boolean; trigger: 'altEnter' | 'tripleSpace'; targetLang: string }
  mask: { enabled: boolean }
  glossary: GlossaryTerm[]
  /** AI 专家（prompt 策略），仅 AI 引擎生效 */
  experts: { activeId: string; list: ExpertPreset[] }
  /** 术语库：内置库开关（id→enabled，库数据打包在 public/glossary/）+ 自定义库 */
  glossaryLibs: { enabled: Record<string, boolean>; custom: CustomGlossaryLibrary[] }
  writing: { enabled: boolean }
  subtitles: { enabled: boolean; youtube: boolean; meet: boolean }
  learning: { enabled: boolean; highlightOnPage: boolean }
  floatingBall: { enabled: boolean }
  /** TTS 朗读参数 */
  tts: { rate: number; pitch: number; volume: number }
  /** 全页摘要上下文感知（仅 AI 引擎生效） */
  contextAware: { enabled: boolean }
  /** Alt+D 对比窗要同时调用的引擎 id 列表 */
  compareEngines: string[]
  /** 可自定义快捷键（如 'Alt+T'；空串=禁用） */
  hotkeys: { togglePage: string; compare: string; openOptions: string }
  /** 界面显示语言（与翻译目标语言无关）；auto=跟随系统 */
  uiLang: string
  /** 首次安装引导是否已完成 */
  onboardingCompleted: boolean
  stats: { translatedChars: number }
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  general: {
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual',
    autoTranslateSites: [],
    autoTranslateLangs: [],
    neverTranslateSites: [],
  },
  engine: {
    provider: 'google',
    keys: { deepl: '', openai: '', claude: '', gemini: '', libreUrl: '', customHeadersJson: '', aimao: '' },
    openai: { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    claude: { model: 'claude-haiku-4-5-20251001' },
    gemini: { model: 'gemini-2.5-flash' },
    aimao: { model: 'DeepSeek-V4-Flash' },
    customEngines: [],
    custom: { url: '', bodyJson: '{"text":"{{text}}","from":"{{from}}","to":"{{to}}"}' },
    timeoutMs: 20000,
  },
  batch: { enabled: true, maxTexts: 8, maxChars: 1200, intervalMs: 120, concurrency: 3 },
  style: { styleId: 'soft-gray' },
  selection: { enabled: true, mode: 'bilingual', maxChars: 2000 },
  hover: { enabled: true, key: 'alt' },
  input: { enabled: true, trigger: 'altEnter', targetLang: 'en' },
  mask: { enabled: false },
  glossary: [],
  experts: { activeId: 'general', list: BUILTIN_EXPERTS },
  glossaryLibs: { enabled: {}, custom: [] },
  writing: { enabled: true },
  subtitles: { enabled: true, youtube: true, meet: true },
  learning: { enabled: true, highlightOnPage: false },
  floatingBall: { enabled: true },
  tts: { rate: 1, pitch: 1, volume: 1 },
  contextAware: { enabled: false },
  compareEngines: ['google', 'bing'],
  hotkeys: { togglePage: 'Alt+T', compare: 'Alt+D', openOptions: 'Alt+O' },
  uiLang: 'auto',
  onboardingCompleted: false,
  stats: { translatedChars: 0 },
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function merge<T>(defaults: T, raw: unknown): T {
  if (Array.isArray(defaults)) {
    return (Array.isArray(raw) ? raw : defaults) as unknown as T
  }
  if (isObj(defaults)) {
    const out: Record<string, unknown> = { ...defaults }
    if (isObj(raw)) {
      for (const k of Object.keys(defaults)) {
        if (raw[k] !== undefined) out[k] = merge(defaults[k], raw[k])
      }
    }
    return out as T
  }
  return (raw !== undefined && typeof raw === typeof defaults ? raw : defaults) as T
}

/** 读时归一化：脏 key 丢弃、缺失 key 补默认、类型不符回退默认。 */
export function normalizeConfig(raw: unknown): Config {
  return merge(DEFAULT_CONFIG, isObj(raw) ? raw : {})
}
