// AI 专家：内置翻译策略预设（仅对 AI 引擎生效，机器翻译忽略）。
// userPrompt 支持占位符：{{text}} {{to}} {{from}} {{glossary}} {{tone}}
export interface ExpertPreset {
  id: string
  /** 中文名（UI 回退原文用；预设会复制进用户配置，显示时按 nameKey 本地化） */
  name: string
  /** i18n 键（仅内置预设有；自定义专家省略则始终显示 name） */
  nameKey?: string
  builtin: boolean
  systemPrompt: string
  userPrompt: string
}

const BASE_USER = 'Translate the following text into {{to}}. Output only the translation, no explanations:\n\n{{text}}'

export const BUILTIN_EXPERTS: ExpertPreset[] = [
  {
    id: 'general',
    nameKey: 'expert.general',
    name: '通用',
    builtin: true,
    systemPrompt: 'You are a professional, authentic translation engine.',
    userPrompt: BASE_USER,
  },
  {
    id: 'tech',
    nameKey: 'expert.tech',
    name: '技术文档',
    builtin: true,
    systemPrompt:
      'You are a professional technical documentation translator. Keep code, commands, file paths, API names and version numbers untranslated. Use precise, consistent terminology.',
    userPrompt: BASE_USER,
  },
  {
    id: 'literary',
    nameKey: 'expert.literary',
    name: '文学',
    builtin: true,
    systemPrompt:
      'You are a literary translator. Preserve the author\'s voice, rhythm, imagery and cultural nuance. Favor natural, elegant prose over literal word-for-word rendering.',
    userPrompt: BASE_USER,
  },
  {
    id: 'academic',
    nameKey: 'expert.academic',
    name: '学术',
    builtin: true,
    systemPrompt:
      'You are an academic translator. Use formal register and discipline-appropriate terminology. Keep citations, formulas, figure/table references and proper nouns intact.',
    userPrompt: BASE_USER,
  },
  {
    id: 'social',
    nameKey: 'expert.social',
    name: '社交媒体',
    builtin: true,
    systemPrompt:
      'You are a social-media translator. Keep the casual tone, slang, memes, hashtags and @mentions. Translate emoji meaning, not just words. Keep it short and punchy.',
    userPrompt: BASE_USER,
  },
]

export function getExpert(list: ExpertPreset[], id: string): ExpertPreset {
  return list.find((e) => e.id === id) ?? BUILTIN_EXPERTS[0]
}

/** 渲染专家 userPrompt：替换 {{text}} {{to}} {{from}} {{glossary}}；空占位所在行整行删除 */
export function renderExpertPrompt(
  template: string,
  vars: { text: string; to: string; from: string; glossary?: string },
): string {
  return template
    .split('\n')
    .filter((line) => !(line.includes('{{glossary}}') && !vars.glossary))
    .join('\n')
    .replaceAll('{{text}}', vars.text)
    .replaceAll('{{to}}', vars.to)
    .replaceAll('{{from}}', vars.from)
    .replaceAll('{{glossary}}', vars.glossary ?? '')
}
