// Alt+D 多引擎对比翻译：对 engineIds 并行调用 translate() 管线，
// Promise.allSettled 容错——单引擎失败只影响自己那张卡片，其余照常返回。

import type { Config } from '../shared/config'
import { translate } from './translate'
import { ENGINES } from './engines'

/** 单个引擎的对比结果：成功带 text，失败带 error，两者均带耗时。 */
export interface CompareResult {
  engineId: string
  /** 引擎注册表显示名（未知引擎回退 id） */
  name: string
  text?: string
  error?: string
  elapsedMs: number
}

/** config.compareEngines 为空时的默认对比引擎集合。 */
export const DEFAULT_COMPARE_ENGINES: readonly string[] = ['google', 'bing']

/**
 * translate() 按 config.engine.provider 路由引擎：为每个对比引擎构造临时
 * 配置副本（浅拷贝 engine 字段换 provider），绝不改写传入的原配置。
 */
function configForEngine(config: Config, engineId: string): Config {
  return {
    ...config,
    engine: { ...config.engine, provider: engineId as Config['engine']['provider'] },
  }
}

/**
 * 并行对比翻译。engineIds 为空回退 DEFAULT_COMPARE_ENGINES；重复 id 去重（保序）。
 * 每个引擎独立走完整 translate() 管线（缓存 / mask / glossary / 冷却降级均生效），
 * 单引擎抛错被捕获为该卡片的 error，不影响其余引擎。
 */
export async function compareTranslate(
  text: string,
  targetLang: string,
  engineIds: string[],
  config: Config,
): Promise<CompareResult[]> {
  const source = engineIds.length > 0 ? engineIds : DEFAULT_COMPARE_ENGINES
  const ids = source.filter((id, i) => source.indexOf(id) === i)

  // 任务内部捕获全部异常并自带计时，allSettled 双保险（理论上不会拿到 rejected）
  const tasks = ids.map(async (id): Promise<CompareResult> => {
    const name = ENGINES[id]?.name ?? id
    const started = Date.now()
    try {
      const r = await translate(text, { targetLang }, configForEngine(config, id))
      return { engineId: id, name, text: r.text, elapsedMs: Date.now() - started }
    } catch (e) {
      return {
        engineId: id,
        name,
        error: e instanceof Error ? e.message : String(e),
        elapsedMs: Date.now() - started,
      }
    }
  })

  const settled = await Promise.allSettled(tasks)
  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value
    const id = ids[i]
    return {
      engineId: id,
      name: ENGINES[id]?.name ?? id,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      elapsedMs: 0,
    }
  })
}
