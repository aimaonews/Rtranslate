/**
 * Rtranslate core — 译文样式定义（id / 中文名 / 英文名 / CSS 类名）。
 *
 * className 统一 `tv-style-*` kebab，具体样式由 content.css 实现；
 * config.style.styleId 存 id，渲染时 getStyle(id) 取类名，未知 id 回退 soft-gray。
 *
 * 本模块为 core 纯逻辑：零浏览器 API、零外部依赖。
 */

export interface TranslationStyle {
  /** 唯一 id，存 config.style.styleId */
  id: string
  /** 中文名（UI 回退原文用） */
  name: string
  /** 英文名（设置页样式卡片副标题用） */
  nameEn: string
  /** i18n 键：设置页样式 tab 与 popup 样式下拉共用 */
  nameKey: string
  /** content.css 中的样式类，统一 tv-style-* */
  className: string
}

export const TRANSLATION_STYLES: TranslationStyle[] = [
  { id: 'soft-gray', name: '柔和灰', nameEn: 'Soft Gray', className: 'tv-style-soft-gray', nameKey: 'style.soft-gray' },
  { id: 'plain', name: '继承原文', nameEn: 'Plain', className: 'tv-style-plain', nameKey: 'style.plain' },
  { id: 'bold', name: '加粗', nameEn: 'Bold', className: 'tv-style-bold', nameKey: 'style.bold' },
  { id: 'italic', name: '斜体', nameEn: 'Italic', className: 'tv-style-italic', nameKey: 'style.italic' },
  { id: 'underline-dotted', name: '虚线下划线', nameEn: 'Dotted Underline', className: 'tv-style-underline-dotted', nameKey: 'style.underline-dotted' },
  { id: 'highlight-yellow', name: '黄色高亮', nameEn: 'Yellow Highlight', className: 'tv-style-highlight-yellow', nameKey: 'style.highlight-yellow' },
  { id: 'highlight-green', name: '绿色高亮', nameEn: 'Green Highlight', className: 'tv-style-highlight-green', nameKey: 'style.highlight-green' },
  { id: 'card', name: '卡片边框', nameEn: 'Card', className: 'tv-style-card', nameKey: 'style.card' },
  { id: 'rounded', name: '圆角底', nameEn: 'Rounded', className: 'tv-style-rounded', nameKey: 'style.rounded' },
  { id: 'quote', name: '引用竖线', nameEn: 'Quote', className: 'tv-style-quote', nameKey: 'style.quote' },
  { id: 'gradient', name: '蓝紫渐变', nameEn: 'Gradient', className: 'tv-style-gradient', nameKey: 'style.gradient' },
  { id: 'frosted', name: '半透明毛玻璃', nameEn: 'Frosted Glass', className: 'tv-style-frosted', nameKey: 'style.frosted' },
  { id: 'blur-mask', name: '模糊遮罩（悬停显示）', nameEn: 'Blur Mask', className: 'tv-style-blur-mask', nameKey: 'style.blur-mask' },
]

const STYLE_INDEX: ReadonlyMap<string, TranslationStyle> = new Map(
  TRANSLATION_STYLES.map((s) => [s.id, s]),
)

/** 按 id 取样式；找不到回退 soft-gray（数组首位）。 */
export function getStyle(id: string): TranslationStyle {
  return STYLE_INDEX.get(id) ?? TRANSLATION_STYLES[0]
}
