// i18n 基础设施：10 语言支持。界面语言（uiLang）只影响扩展自身 UI，与翻译目标语言无关。
// zh-CN 是源语言（代码内中文即原文）；auto 跟随浏览器界面语言。

export type UiLangCode = 'auto' | 'en' | 'de' | 'es' | 'fr' | 'pt-BR' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko'
export type ResolvedLang = Exclude<UiLangCode, 'auto'>

/** 界面语言菜单选项（严格按需求顺序排列） */
export const UI_LANGS: ReadonlyArray<{ code: UiLangCode; name: string }> = [
  { code: 'auto', name: '跟随系统' },  // 显示名由 general.uiLangAuto 字典键按当前界面语言本地化
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ko', name: '한국어' },
]

/** 浏览器界面语言 → 支持的语言（不匹配回退 en） */
export function resolveUiLang(uiLang: UiLangCode | string, browserLang?: string): ResolvedLang {
  if (uiLang !== 'auto') return uiLang as ResolvedLang
  const raw = (browserLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase()
  if (raw.startsWith('zh')) {
    return raw.includes('tw') || raw.includes('hk') || raw.includes('mo') || raw.includes('hant') ? 'zh-TW' : 'zh-CN'
  }
  if (raw.startsWith('de')) return 'de'
  if (raw.startsWith('es')) return 'es'
  if (raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('pt')) return 'pt-BR'
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('ko')) return 'ko'
  return 'en'
}

// ===== 字典注册表（各模块可注册词条，避免单文件冲突） =====

const DICTS = new Map<ResolvedLang, Map<string, string>>()

/** 注册某语言的一批词条（同语言多次注册会合并，后者覆盖前者） */
export function registerDict(lang: ResolvedLang, dict: Record<string, string>): void {
  const cur = DICTS.get(lang) ?? new Map<string, string>()
  for (const [k, v] of Object.entries(dict)) cur.set(k, v)
  DICTS.set(lang, cur)
}

/** 取界面文案；zh-CN 直接回退原文；其他语言查注册表，缺 key 回退原文 */
export function t(key: string, lang: ResolvedLang | string, zhFallback: string): string {
  if (lang === 'zh-CN') return zhFallback
  return DICTS.get(lang as ResolvedLang)?.get(key) ?? zhFallback
}

/** 便捷：按配置取文案（自动解析 auto） */
export function tAuto(key: string, uiLang: UiLangCode | string, zhFallback: string): string {
  return t(key, resolveUiLang(uiLang), zhFallback)
}

/** 占位符插值：fmt('已翻译 {n} 段', {n: 5}) */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '{' + k + '}'))
}

// ===== 英文基础字典 =====

const EN: Record<string, string> = {
  // 通用
  'settings': 'Settings',
  'lang.autoDetect': 'Auto-detect', 'lang.commonGroup': 'Common languages', 'lang.allGroup': 'All languages', 'brand.settings': 'Settings',
  // content script UI（划词气泡/悬浮球/输入框/译文状态/对比窗口）
  'sel.writeFailed': 'Failed: ',
  'sel.ai': 'AI Insights',
  'sel.write': '✍ Write',
  'sel.save': '☆ Save',
  'sel.speak': 'Read aloud',
  'sel.stop': 'Stop',
  'sel.copy': 'Copy',
  'sel.close': 'Close',
  'sel.translating': 'Translating…',
  'sel.translateFailed': 'Translation failed: ',
  'sel.copied': 'Copied',
  'sel.copyFailed': 'Copy failed',
  'sel.savedWord': 'Saved to wordbook',
  'sel.ttsUnavailable': 'Read-aloud unavailable',
  'sel.aiThinking': 'Thinking…',
  'sel.aiStartHint': 'Choose an action above to start.',
  'sel.aiFollowPh': 'Ask more: usage / synonyms / examples…',
  'sel.aiBusy': 'First analysis in progress, please wait',
  'sel.aiSend': 'Send',
  'sel.aiRequestFailed': '(Request failed: {msg})',
  'sel.generating': 'Generating…',
  'sel.replace': 'Replace selection',
  'sel.replaced': 'Selection replaced',
  'sel.replaceFailed': 'Replace failed',
  'sel.notEditable': 'Not editable; copied to clipboard',
  'sel.write.polish': 'Polish',
  'sel.write.continue': 'Continue',
  'sel.write.summarize': 'Summarize',
  'sel.write.reply': 'Reply',
  'sel.write.translate': 'Translate',
  'sel.tone.default': 'Tone: Default',
  'sel.tone.formal': 'Tone: Formal',
  'sel.tone.casual': 'Tone: Casual',
  'sel.tone.humorous': 'Tone: Humorous',
  'sel.tone.professional': 'Tone: Professional',
  'sel.length.default': 'Length: Default',
  'sel.length.shorter': 'Length: Shorter',
  'sel.length.longer': 'Length: Longer',
  'ball.tip': 'Rtranslate: click to translate / restore (draggable)',
  'input.replaced': 'Translated and replaced',
  'input.replaceFailed': 'Replace failed; paste manually',
  'render.loading': 'Rtranslate translating…',
  'render.retry': 'Retry',
  'cmp.targetLang': 'Target language: ',
  'cmp.engineFailed': 'Failed: ',
  'cmp.runFailed': 'Compare failed: ',
  'sel.aiUnavailable': '({action} unavailable: {msg})',
  'sel.saveFailed': 'Save failed: ',
  'cmp.title': 'Multi-engine compare',
  'cmp.close': 'Close (Esc)',
  'cmp.placeholder': 'Enter text to compare…',
  'cmp.run': 'Compare',
  'cmp.hint': 'Enter text, then click "Compare"',
  'cmp.engine.google': 'Google',
  'cmp.engine.bing': 'Microsoft',
  'cmp.engine.openai': 'OpenAI-compatible',
  'cmp.engine.custom': 'Custom',
  'save': 'Save',
  'saved': 'Saved',
  'cancel': 'Cancel',
  'delete': 'Delete',
  'edit': 'Edit',
  'add': 'Add',
  'test': 'Test connection',
  'testing': 'Testing…',
  // popup
  'popup.translatePage': 'Translate this page',
  'popup.restorePage': 'Restore original',
  'popup.targetLang': 'Target language',
  'popup.sourceLang': 'Source language',
  'popup.displayMode': 'Display mode',
  'popup.bilingual': 'Bilingual',
  'popup.translationOnly': 'Translation only',
  'popup.expert': 'AI expert',
  'popup.style': 'Translation style',
  'popup.engine': 'Translation engine',
  'popup.hover': 'Hover translation',
  'popup.selection': 'Selection translation',
  'popup.floatingBall': 'Floating ball',
  'popup.currentSite': 'Current site',
  'popup.alwaysSite': 'Always translate this site',
  'popup.neverSite': 'Never translate this site',
  'popup.pageUnavailable': 'Unavailable on this page',
  'popup.files': 'Document translation',
  'popup.review': 'Start review',
  'popup.tutorial': 'Tutorial',
  'nav.guide': 'Reopen setup guide',
  'nav.privacy': 'Privacy Policy',
  'popup.openSettings': 'Open settings',
  'popup.statusLoading': 'Detecting page state…',
  'popup.statusIdle': 'Page not translated',
  'popup.statusTranslated': 'Translated {n} segments',
  'popup.statusTranslatedFail': 'Translated {n} segments · {m} failed',
  'popup.opFailed': 'Action failed: ',
  'popup.loadFailed': 'Failed to load config: ',
  'popup.commonLangs': 'Common languages',
  'popup.allLangs': 'All languages',
  'popup.expertBuiltin': 'Built-in',
  'popup.expertCustom': 'Custom',
  'popup.stats': 'Words {w} · Due {d}',
  'popup.statsEmpty': 'Words — · Due —',
  // options 标签
  'tab.general': 'General',
  'tab.engine': 'Engines',
  'tab.experts': 'AI Experts',
  'tab.style': 'Styles',
  'tab.privacy': 'Privacy',
  'tab.glossary': 'Glossary',
  'tab.glossaryLibs': 'AI Terminology',
  'tab.writing': 'AI Writing',
  'tab.tts': 'Speech',
  'tab.words': 'Wordbook',
  'tab.interaction': 'Interaction',
  'tab.hotkeys': 'Hotkeys',
  // options 页面说明
  'tabDesc.general': 'Language, display mode, and site/language lists',
  'tabDesc.engine': 'Translation engine selection, API keys, batch and timeout settings',
  'tabDesc.experts': 'Custom AI translation strategies (prompts); AI engines only',
  'tabDesc.style': 'How translations appear on the page',
  'tabDesc.privacy': 'Local sensitive-data masking and usage statistics',
  'tabDesc.glossary': 'Fixed terminology for consistent translations',
  'tabDesc.glossaryLibs': 'Domain terminology libraries and smart extraction; AI engines only',
  'tabDesc.writing': 'Tone and length preferences for the AI writing assistant',
  'tabDesc.tts': 'Reading rate, pitch, and volume',
  'tabDesc.hotkeys': 'Custom global hotkeys',
  'tabDesc.words': 'Saved words, with JSON import/export',
  'tabDesc.interaction': 'Hover, selection and input-box translation, plus the floating ball',
  // 通用页
  'general.uiLang': 'Interface language',
  'general.uiLangAuto': 'Follow system',
  'general.uiLangDesc': "The extension's display language; unrelated to translation target language.",
  'general.targetLang': 'Target language',
  'general.targetLangDesc': 'Choose the language pages are translated into. All common languages are supported.',
  'general.displayMode': 'Display mode',
  'general.displayModeDesc': 'Control how the translation and the original text appear on the page.',
  'general.bilingual': 'Bilingual',
  'general.bilingualDesc': 'Keep the original text and append the translation below it',
  'general.translationOnly': 'Translation only',
  'general.translationOnlyDesc': 'Hide the original text and show only the translation',
  'general.autoSites': 'Always translate these sites',
  'general.autoSitesDesc': 'Automatically translate the whole page when visiting the sites below.',
  'general.autoLangs': 'Always translate these languages',
  'general.autoLangsDesc': 'Automatically translate pages detected in the languages below. Click to toggle.',
  'general.neverSites': 'Never translate these sites',
  'general.neverSitesDesc': 'Pages on the sites below are never translated.',
  'general.domainPlaceholder': 'Enter a domain, e.g. example.com',
}

registerDict('en', EN)

/** 兼容旧签名（旧代码 t(key, 'en'|'zh-CN', fallback) 仍可用） */
export type UiLang = UiLangCode
