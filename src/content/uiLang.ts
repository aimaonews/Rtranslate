/**
 * 内容脚本 i18n 桥：index.ts 的 applyConfig 先于一切 set*Config 调用 setContentUiLang，
 * 各内容模块（气泡/悬浮球/输入框/译文状态/对比窗口）统一用 ct() 取文案。
 * zh-CN 直接回退中文原文；其余语言查 shared/i18n 注册表。
 */
import { t, resolveUiLang } from '../shared/i18n'
import '../shared/i18n-dicts' // 注册 7 语言通用字典（副作用导入，否则 t() 查不到回退中文）
import type { Config } from '../shared/config'
import { previewGlyph } from '../shared/uiLabels'

let lang: string = 'zh-CN'

export function setContentUiLang(config: Config): void {
  lang = resolveUiLang(config.uiLang)
}

/** 内容脚本取文案（key 缺失或 zh-CN 时回退中文原文） */
export function ct(key: string, zhFallback: string): string {
  return t(key, lang, zhFallback)
}

/** 悬浮球字符：中文界面用「译」，其余用「A」（与预览字符同一规则） */
export function ballGlyph(): string {
  return previewGlyph(lang)
}
