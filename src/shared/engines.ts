/**
 * 内置翻译引擎显示名（单一数据源）：popup / options / onboarding 三处下拉共用。
 * 品牌名（aimao / DeepL / Claude …）各语言不译；"免费/兼容"本地化。
 * 各页按需取 name（nameKey 查表）；options 引擎 tab 额外取 desc。
 */
import { t } from './i18n'
import type { UiLangCode } from './i18n'

export interface BuiltinEngine {
  id: string
  nameKey: string
  zh: string
  descKey?: string
  descZh?: string
}

export const BUILTIN_ENGINES: ReadonlyArray<BuiltinEngine> = [
  { id: 'aimao', nameKey: 'engine.aimao', zh: 'aimao', descKey: 'engine.aimaoDesc', descZh: 'aimao 提供的 OpenAI 兼容翻译服务，开箱即用。' },
  { id: 'google', nameKey: 'engine.google', zh: '谷歌（免费）', descKey: 'engine.googleDesc', descZh: '谷歌 gtx 免费端点，开箱即用，无需密钥。' },
  { id: 'bing', nameKey: 'engine.bing', zh: '微软（免费）', descKey: 'engine.bingDesc', descZh: '微软 Edge 翻译端点，免费引擎链备选。' },
  { id: 'mymemory', nameKey: 'engine.mymemory', zh: 'MyMemory（免费）', descKey: 'engine.mymemoryDesc', descZh: 'MyMemory 免费接口，免费引擎链兜底。' },
  { id: 'deepl', nameKey: 'engine.deepl', zh: 'DeepL', descKey: 'engine.deeplDesc', descZh: 'DeepL 官方 API，需自备 API Key，翻译质量高。' },
  { id: 'openai', nameKey: 'engine.openai', zh: 'OpenAI 兼容', descKey: 'engine.openaiDesc', descZh: 'OpenAI / 硅基流动 / Ollama 等一切 OpenAI 兼容端点，需 API Key。' },
  { id: 'deepseek', nameKey: 'engine.deepseek', zh: 'DeepSeek', descKey: 'engine.deepseekDesc', descZh: 'DeepSeek 官方 API（OpenAI 兼容协议），需 API Key。' },
  { id: 'claude', nameKey: 'engine.claude', zh: 'Claude (Anthropic)', descKey: 'engine.claudeDesc', descZh: 'Anthropic Claude 官方 API，需自备 API Key，翻译质量高。' },
  { id: 'gemini', nameKey: 'engine.gemini', zh: 'Gemini (Google)', descKey: 'engine.geminiDesc', descZh: 'Google Gemini 官方 API，需自备 API Key，速度快、免费额度慷慨。' },
  { id: 'libretranslate', nameKey: 'engine.libretranslate', zh: 'LibreTranslate', descKey: 'engine.libretranslateDesc', descZh: '开源可自托管的翻译服务，填写实例地址即可。' },
]

/** 引擎显示名（按界面语言）。 */
export function engineName(e: BuiltinEngine, uiLang: UiLangCode | string): string {
  return t(e.nameKey, uiLang, e.zh)
}

/** 引擎说明（仅 options 引擎 tab 用）。 */
export function engineDesc(e: BuiltinEngine, uiLang: UiLangCode | string): string {
  if (!e.descKey || !e.descZh) return ''
  return t(e.descKey, uiLang, e.descZh)
}
