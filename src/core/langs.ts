/**
 * Rtranslate core — 语言表（code ↔ 中英文全名）。
 *
 * LLM system prompt 用「目标语言全名」（langName(code, 'en')），不依赖引擎认语言码
 * （OpenImmersive 3.2 的做法）。UI 语言切换时 langName(code, 'zh') 返回中文名。
 *
 * 本模块为 core 纯逻辑：零浏览器 API、零外部依赖。
 */

export interface LangEntry {
  code: string
  /** 英文全名（LLM prompt 用） */
  en: string
  /** 中文名（UI 用） */
  zh: string
}

/** 常用语言表；code 均为主码（normalizeLangCode 归一后的形态），auto 表示自动检测。 */
export const LANGS: LangEntry[] = [
  { code: 'auto', en: 'Auto-detect', zh: '自动检测' },
  { code: 'zh-CN', en: 'Simplified Chinese', zh: '简体中文' },
  { code: 'zh-TW', en: 'Traditional Chinese', zh: '繁體中文' },
  { code: 'en', en: 'English', zh: '英语' },
  { code: 'ja', en: 'Japanese', zh: '日语' },
  { code: 'ko', en: 'Korean', zh: '韩语' },
  { code: 'fr', en: 'French', zh: '法语' },
  { code: 'de', en: 'German', zh: '德语' },
  { code: 'es', en: 'Spanish', zh: '西班牙语' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语' },
  { code: 'it', en: 'Italian', zh: '意大利语' },
  { code: 'ru', en: 'Russian', zh: '俄语' },
  { code: 'ar', en: 'Arabic', zh: '阿拉伯语' },
  { code: 'hi', en: 'Hindi', zh: '印地语' },
  { code: 'th', en: 'Thai', zh: '泰语' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语' },
  { code: 'id', en: 'Indonesian', zh: '印尼语' },
  { code: 'ms', en: 'Malay', zh: '马来语' },
  { code: 'tr', en: 'Turkish', zh: '土耳其语' },
  { code: 'nl', en: 'Dutch', zh: '荷兰语' },
  { code: 'pl', en: 'Polish', zh: '波兰语' },
  { code: 'sv', en: 'Swedish', zh: '瑞典语' },
  { code: 'da', en: 'Danish', zh: '丹麦语' },
  { code: 'fi', en: 'Finnish', zh: '芬兰语' },
  { code: 'no', en: 'Norwegian', zh: '挪威语' },
  { code: 'cs', en: 'Czech', zh: '捷克语' },
  { code: 'el', en: 'Greek', zh: '希腊语' },
  { code: 'he', en: 'Hebrew', zh: '希伯来语' },
  { code: 'uk', en: 'Ukrainian', zh: '乌克兰语' },
  { code: 'ro', en: 'Romanian', zh: '罗马尼亚语' },
  { code: 'hu', en: 'Hungarian', zh: '匈牙利语' },
  { code: 'ca', en: 'Catalan', zh: '加泰罗尼亚语' },
  { code: 'eu', en: 'Basque', zh: '巴斯克语' },
  { code: 'fa', en: 'Persian', zh: '波斯语' },
  { code: 'ur', en: 'Urdu', zh: '乌尔都语' },
  { code: 'bn', en: 'Bengali', zh: '孟加拉语' },
  { code: 'ta', en: 'Tamil', zh: '泰米尔语' },
  { code: 'te', en: 'Telugu', zh: '泰卢固语' },
  { code: 'ml', en: 'Malayalam', zh: '马拉雅拉姆语' },
  { code: 'sw', en: 'Swahili', zh: '斯瓦希里语' },
  { code: 'mr', en: 'Marathi', zh: '马拉地语' },
  { code: 'kn', en: 'Kannada', zh: '卡纳达语' },
  { code: 'pa', en: 'Punjabi', zh: '旁遮普语' },
  { code: 'gu', en: 'Gujarati', zh: '古吉拉特语' },
  { code: 'my', en: 'Burmese', zh: '缅甸语' },
  { code: 'km', en: 'Khmer', zh: '高棉语' },
  { code: 'lo', en: 'Lao', zh: '老挝语' },
  { code: 'ne', en: 'Nepali', zh: '尼泊尔语' },
  { code: 'si', en: 'Sinhala', zh: '僧伽罗语' },
]

/** 常用语言码（约 20 种），UI 快捷列表用。 */
export const COMMON_LANG_CODES: string[] = [
  'auto',
  'zh-CN',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'ar',
  'hi',
  'th',
  'vi',
  'id',
  'ms',
  'tr',
  'nl',
]

const LANG_INDEX: ReadonlyMap<string, LangEntry> = new Map(LANGS.map((l) => [l.code, l]))

/**
 * 归一化语言码：去空白、下划线转连字符、主码小写，统一归到 LANGS 的主码形态。
 * 'auto' 原样保留；'zh' 系无地区默认 'zh-CN'；'zh-Hant'/'zh-HK'/'zh-MO' 归 'zh-TW'；
 * 'zh-Hans' 归 'zh-CN'；其余语种丢弃地区子标签（en-US→en、pt-BR→pt）。
 */
export function normalizeLangCode(code: string): string {
  const c = code.trim().replace(/_/g, '-')
  if (!c) return c
  if (c.toLowerCase() === 'auto') return 'auto'
  const parts = c.split('-').filter(Boolean)
  const primary = parts[0].toLowerCase()
  const region = parts.slice(1).join('-').toLowerCase()
  if (primary === 'zh') {
    if (region === 'hant' || region === 'tw' || region === 'hk' || region === 'mo') return 'zh-TW'
    return 'zh-CN' // 无地区、Hans、CN、SG 一律简体
  }
  return primary
}

/**
 * 语言全名；先归一再查表，未命中回退归一后的码本身。
 * uiLang 省略时返回英文全名（LLM prompt 用）；'zh' 返回中文名。
 */
export function langName(code: string, uiLang: 'zh' | 'en' = 'en'): string {
  const c = normalizeLangCode(code)
  const hit = LANG_INDEX.get(c)
  if (!hit) return c || code
  return uiLang === 'zh' ? hit.zh : hit.en
}
