import type { Config } from '../../shared/config'

export interface EngineContext {
  config: Config
}

export interface EngineResult {
  text: string
  /** 引擎顺带检测出的源语言码（如 Google data[2]）；未提供则省略 */
  detectedLang?: string
}

export interface Engine {
  id: string
  name: string
  kind: 'free' | 'byok'
  requiresKey?: boolean
  /** LLM 引擎支持编号 JSON 批协议（BatchQueue 用） */
  supportsBatch?: boolean
  /** 单次 translate 建议的上限字符数（超出由管线截断/切块） */
  maxTextLength?: number
  translate(text: string, from: string, to: string, ctx: EngineContext, signal?: AbortSignal): Promise<EngineResult>
  translateBatch?(
    texts: string[],
    from: string,
    to: string,
    ctx: EngineContext,
    signal?: AbortSignal
  ): Promise<string[]>
}
