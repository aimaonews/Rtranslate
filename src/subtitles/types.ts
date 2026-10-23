// 字幕翻译共享契约：YouTube 与会议字幕共用同一数据模型
import type { Config } from '../shared/config'
import type { BgResponse } from '../shared/protocol'

export interface SubtitleCue {
  start: number // 秒
  end: number
  text: string
  translation?: string
}

/** 翻译函数：内容脚本经 background 消息 */
export async function translateText(text: string, targetLang: string): Promise<string> {
  const resp = (await chrome.runtime.sendMessage({
    kind: 'translate',
    text,
    targetLang,
  })) as BgResponse<{ text: string }>
  if (!resp.ok) throw new Error(resp.error)
  return resp.data.text
}

export async function getSubtitlesConfig(): Promise<Config | null> {
  try {
    const resp = (await chrome.runtime.sendMessage({ kind: 'getConfig' })) as BgResponse<Config>
    return resp.ok ? resp.data : null
  } catch {
    return null
  }
}
