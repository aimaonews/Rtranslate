// AI猫（aimao.today）内置引擎：OpenAI 兼容协议，端点固定，无需用户填 endpoint。
// key 走 config.engine.keys.aimao，model 走 config.engine.aimao.model；
// system prompt / 批协议 / stripThinking 全部复用 openaiCompat 工厂，与其他 AI 引擎行为一致。
import { createOpenAICompatEngine } from './openaiCompat'

/** AI猫固定端点（endpointUrlOf 与引擎共用此常量，避免两处漂移）。 */
export const AIMAO_ENDPOINT = 'https://api.aimao.today/v1'

export const aimaoEngine = createOpenAICompatEngine({
  id: 'aimao',
  name: 'AI猫',
  getEndpoint: () => AIMAO_ENDPOINT,
  getApiKey: (ctx) => ctx.config.engine.keys.aimao,
  getModel: (ctx) => ctx.config.engine.aimao.model,
})
