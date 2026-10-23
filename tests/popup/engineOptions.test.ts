import { describe, it, expect } from 'vitest'
import { getEngineOptions, engineIconFor, ENGINE_ICON_FILES } from '../../src/popup/main'
import { DEFAULT_CONFIG, type Config } from '../../src/shared/config'

function cfg(customEngines: Config['engine']['customEngines'] = []): Config {
  return { ...DEFAULT_CONFIG, engine: { ...DEFAULT_CONFIG.engine, customEngines } }
}

describe('getEngineOptions', () => {
  it('AI猫(aimao) 排第一', () => {
    const options = getEngineOptions(cfg())
    expect(options[0].id).toBe('aimao')
    expect(options[0].name).toBe('AI猫')
  })

  it('内置引擎顺序：aimao 后依次为 google/bing/mymemory/deepl/openai/deepseek/claude/gemini/libretranslate', () => {
    const ids = getEngineOptions(cfg()).map((o) => o.id)
    expect(ids).toEqual([
      'aimao',
      'google',
      'bing',
      'mymemory',
      'deepl',
      'openai',
      'deepseek',
      'claude',
      'gemini',
      'libretranslate',
    ])
  })

  it('customEngines 追加在内置之后：id 带 custom: 前缀，name 取 entry.name', () => {
    const options = getEngineOptions(
      cfg([
        { id: 'foo', name: '我的引擎', endpoint: 'https://a.com/v1', apiKey: 'k', model: 'm', headersJson: '' },
        { id: 'bar', name: '另一个', endpoint: 'https://b.com/v1', apiKey: 'k', model: 'm', headersJson: '' },
      ]),
    )
    expect(options).toHaveLength(12)
    expect(options[10]).toMatchObject({ id: 'custom:foo', name: '我的引擎' })
    expect(options[11]).toMatchObject({ id: 'custom:bar', name: '另一个' })
  })
})

describe('引擎图标映射', () => {
  it('aimao 与用户提供的图标用 png，其余内置引擎用同名 svg', () => {
    expect(engineIconFor('aimao')).toBe('engine-icons/aimao.png')
    expect(engineIconFor('mymemory')).toBe('engine-icons/mymemory.png')
    expect(engineIconFor('libretranslate')).toBe('engine-icons/libretranslate.png')
    for (const id of ['google', 'bing', 'deepl', 'openai', 'deepseek', 'claude', 'gemini']) {
      expect(engineIconFor(id)).toBe(`engine-icons/${id}.svg`)
    }
  })

  it('custom:<id> 一律映射 custom.svg', () => {
    expect(engineIconFor('custom:foo')).toBe('engine-icons/custom.svg')
    expect(engineIconFor('custom:')).toBe('engine-icons/custom.svg')
  })

  it('未知 id 兜底 custom.svg', () => {
    expect(engineIconFor('nonexistent')).toBe(ENGINE_ICON_FILES.custom)
  })

  it('getEngineOptions 返回的 icon 与 engineIconFor 一致', () => {
    const options = getEngineOptions(
      cfg([{ id: 'x1', name: 'X', endpoint: '', apiKey: '', model: '', headersJson: '' }]),
    )
    for (const o of options) expect(o.icon).toBe(engineIconFor(o.id))
  })
})
