/**
 * UI 标签辅助：样式名 / 专家预设名本地化 + 「译」预览字符。
 * 数据层的 nameKey（core/styles、core/experts）在此解析；
 * 悬浮球与三处预览 swatch/logo 的「译」字符按同一规则：中文界面「译」，其余「A」。
 */
import { t } from './i18n'
import type { TranslationStyle } from '../core/styles'
import { BUILTIN_EXPERTS, type ExpertPreset } from '../core/experts'

export function styleName(s: TranslationStyle, uiLang: string): string {
  return t(s.nameKey, uiLang, s.name)
}

export function expertName(e: ExpertPreset, uiLang: string): string {
  if (e.nameKey) return t(e.nameKey, uiLang, e.name)
  // 旧版本配置持久化的预设对象没有 nameKey：按 id 回退查内置表
  const builtin = BUILTIN_EXPERTS.find((b) => b.id === e.id)
  if (builtin?.nameKey) return t(builtin.nameKey, uiLang, builtin.name)
  return e.name
}

/** 「译」预览字符（样式预览 swatch / files 页 logo）：中文界面「译」，其余「A」。 */
export function previewGlyph(uiLang: string): string {
  return uiLang.startsWith('zh') ? '译' : 'A'
}
