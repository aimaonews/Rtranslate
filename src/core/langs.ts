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
  /** 中文名（历史字段，UI 不再直接使用） */
  zh: string
  /** 原生名（各语言用自己文字写自己，任何界面语言下都显示同一份）；auto 无此字段 */
  native?: string
}

/** 常用语言表；code 均为主码（normalizeLangCode 归一后的形态），auto 表示自动检测。 */
export const LANGS: LangEntry[] = [
  { code: 'auto', en: 'Auto-detect', zh: '自动检测' },
  { code: 'zh-CN', en: 'Simplified Chinese', zh: '简体中文', native: '简体中文' },
  { code: 'zh-TW', en: 'Traditional Chinese', zh: '繁體中文', native: '繁體中文' },
  { code: 'en', en: 'English', zh: '英语', native: 'English' },
  { code: 'ja', en: 'Japanese', zh: '日语', native: '日本語' },
  { code: 'ko', en: 'Korean', zh: '韩语', native: '한국어' },
  { code: 'fr', en: 'French', zh: '法语', native: 'Français' },
  { code: 'de', en: 'German', zh: '德语', native: 'Deutsch' },
  { code: 'es', en: 'Spanish', zh: '西班牙语', native: 'Español' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语', native: 'Português' },
  { code: 'it', en: 'Italian', zh: '意大利语', native: 'Italiano' },
  { code: 'ru', en: 'Russian', zh: '俄语', native: 'Русский' },
  { code: 'ar', en: 'Arabic', zh: '阿拉伯语', native: 'العربية' },
  { code: 'hi', en: 'Hindi', zh: '印地语', native: 'हिन्दी' },
  { code: 'th', en: 'Thai', zh: '泰语', native: 'ไทย' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语', native: 'Tiếng Việt' },
  { code: 'id', en: 'Indonesian', zh: '印尼语', native: 'Bahasa Indonesia' },
  { code: 'ms', en: 'Malay', zh: '马来语', native: 'Bahasa Melayu' },
  { code: 'tr', en: 'Turkish', zh: '土耳其语', native: 'Türkçe' },
  { code: 'nl', en: 'Dutch', zh: '荷兰语', native: 'Nederlands' },
  { code: 'pl', en: 'Polish', zh: '波兰语', native: 'Polski' },
  { code: 'sv', en: 'Swedish', zh: '瑞典语', native: 'Svenska' },
  { code: 'da', en: 'Danish', zh: '丹麦语', native: 'Dansk' },
  { code: 'fi', en: 'Finnish', zh: '芬兰语', native: 'Suomi' },
  { code: 'no', en: 'Norwegian', zh: '挪威语', native: 'Norsk' },
  { code: 'cs', en: 'Czech', zh: '捷克语', native: 'Čeština' },
  { code: 'el', en: 'Greek', zh: '希腊语', native: 'Ελληνικά' },
  { code: 'he', en: 'Hebrew', zh: '希伯来语', native: 'עברית' },
  { code: 'uk', en: 'Ukrainian', zh: '乌克兰语', native: 'Українська' },
  { code: 'ro', en: 'Romanian', zh: '罗马尼亚语', native: 'Română' },
  { code: 'hu', en: 'Hungarian', zh: '匈牙利语', native: 'Magyar' },
  { code: 'ca', en: 'Catalan', zh: '加泰罗尼亚语', native: 'Català' },
  { code: 'eu', en: 'Basque', zh: '巴斯克语', native: 'Euskara' },
  { code: 'fa', en: 'Persian', zh: '波斯语', native: 'فارسی' },
  { code: 'ur', en: 'Urdu', zh: '乌尔都语', native: 'اردو' },
  { code: 'bn', en: 'Bengali', zh: '孟加拉语', native: 'বাংলা' },
  { code: 'ta', en: 'Tamil', zh: '泰米尔语', native: 'தமிழ்' },
  { code: 'te', en: 'Telugu', zh: '泰卢固语', native: 'తెలుగు' },
  { code: 'ml', en: 'Malayalam', zh: '马拉雅拉姆语', native: 'മലയാളം' },
  { code: 'sw', en: 'Swahili', zh: '斯瓦希里语', native: 'Kiswahili' },
  { code: 'mr', en: 'Marathi', zh: '马拉地语', native: 'मराठी' },
  { code: 'kn', en: 'Kannada', zh: '卡纳达语', native: 'ಕನ್ನಡ' },
  { code: 'pa', en: 'Punjabi', zh: '旁遮普语', native: 'ਪੰਜਾਬੀ' },
  { code: 'gu', en: 'Gujarati', zh: '古吉拉特语', native: 'ગુજરાતી' },
  { code: 'my', en: 'Burmese', zh: '缅甸语', native: 'မြန်မာ' },
  { code: 'km', en: 'Khmer', zh: '高棉语', native: 'ខ្មែរ' },
  { code: 'lo', en: 'Lao', zh: '老挝语', native: 'ລາວ' },
  { code: 'ne', en: 'Nepali', zh: '尼泊尔语', native: 'नेपाली' },
  { code: 'si', en: 'Sinhala', zh: '僧伽罗语', native: 'සිංහල' },
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

/**
 * 语言原生名（如 ja→日本語、de→Deutsch）。语言选择器统一用它：
 * 任何界面语言下同一份显示，无需按 UI 语言逐个翻译 48 种语言名。
 * 'auto' 与表外码回退英文全名（auto 的本地化文案由 UI 层 t() 处理）。
 */
export function langNative(code: string): string {
  const c = normalizeLangCode(code)
  const hit = LANG_INDEX.get(c)
  if (!hit) return c || code
  return hit.native || hit.en
}
