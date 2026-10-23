// TTS 朗读测试：分句切分（中英文边界/超长硬切）+ 播放器（顺序连播/停止/中断/语种判定）。
// 环境：node（默认），SpeechSynthesisUtterance 打全局 stub，SpeechSynthesis 构造注入 mock。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { splitIntoSentences, detectSpeechLang, TtsPlayer } from '../../src/content/tts'

// ---------- speechSynthesis mock ----------

class MockUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  onend: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(text?: string) {
    this.text = text ?? ''
  }
}

interface MockSynth {
  spoken: MockUtterance[]
  speak: ReturnType<typeof vi.fn<(u: MockUtterance) => void>>
  cancel: ReturnType<typeof vi.fn<() => void>>
}

function makeSynth(): MockSynth {
  const spoken: MockUtterance[] = []
  return {
    spoken,
    speak: vi.fn((u: MockUtterance) => {
      spoken.push(u)
    }),
    cancel: vi.fn(),
  }
}

function asSynth(mock: MockSynth): SpeechSynthesis {
  return mock as unknown as SpeechSynthesis
}

/** 触发第 idx 条已播 utterance 的 onend（模拟自然播完）。 */
function endUtterance(mock: MockSynth, idx: number): void {
  mock.spoken[idx].onend?.({})
}

const OPTS = { rate: 1, pitch: 1, volume: 1 }

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance
})

// ---------- splitIntoSentences ----------

describe('splitIntoSentences', () => {
  it('中文：无空格按句末标点切分', () => {
    expect(splitIntoSentences('你好。世界！真的吗？')).toEqual(['你好。', '世界！', '真的吗？'])
  })

  it('中文：分号也是句末边界', () => {
    expect(splitIntoSentences('其一；其二。')).toEqual(['其一；', '其二。'])
  })

  it('英文：句末标点后跟空白切分', () => {
    expect(splitIntoSentences('Hello world. How are you? I am fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'I am fine!',
    ])
  })

  it('英文：小数点与域名中的句点不切', () => {
    expect(splitIntoSentences('Pi is 3.14. Visit example.com now.')).toEqual([
      'Pi is 3.14.',
      'Visit example.com now.',
    ])
  })

  it('英文：句点后直接跟 CJK 字符也切（中英混排无空格）', () => {
    expect(splitIntoSentences('OK.你好。')).toEqual(['OK.', '你好。'])
  })

  it('闭引号并入前一句', () => {
    expect(splitIntoSentences('他说“你好。”然后走了。')).toEqual(['他说“你好。”', '然后走了。'])
  })

  it('空输入与纯空白返回空数组', () => {
    expect(splitIntoSentences('')).toEqual([])
    expect(splitIntoSentences('   ')).toEqual([])
  })

  it('无标点整句原样返回（trim 后）', () => {
    expect(splitIntoSentences('  没有标点的一句话  ')).toEqual(['没有标点的一句话'])
  })

  it('超长句无逗号无空白：定长硬切，拼接不丢字符', () => {
    const text = 'a'.repeat(400)
    const parts = splitIntoSentences(text, 180)
    expect(parts.map((p) => p.length)).toEqual([180, 180, 40])
    expect(parts.join('')).toBe(text)
  })

  it('超长句优先在逗号后切', () => {
    const text = 'a'.repeat(100) + '，' + 'b'.repeat(100)
    const parts = splitIntoSentences(text, 180)
    expect(parts).toEqual(['a'.repeat(100) + '，', 'b'.repeat(100)])
  })

  it('超长英文句在空白处切，保持单词完整', () => {
    const w = 'x'.repeat(60)
    const text = [w, w, w, w].join(' ') // 243 字符
    const parts = splitIntoSentences(text, 180)
    expect(parts.length).toBe(2)
    expect(parts[0]).toBe(`${w} ${w}`)
    expect(parts[1]).toBe(`${w} ${w}`)
  })

  it('默认 maxLen=180：短句不受影响', () => {
    expect(splitIntoSentences('短句。')).toEqual(['短句。'])
  })
})

// ---------- detectSpeechLang ----------

describe('detectSpeechLang', () => {
  it('中文 → zh-CN', () => {
    expect(detectSpeechLang('你好世界')).toBe('zh-CN')
  })

  it('日文（汉字+假名混写，假名占优）→ ja-JP', () => {
    expect(detectSpeechLang('こんにちは世界')).toBe('ja-JP')
  })

  it('韩文 → ko-KR', () => {
    expect(detectSpeechLang('안녕하세요')).toBe('ko-KR')
  })

  it('英文 → 默认 en-US', () => {
    expect(detectSpeechLang('Hello world')).toBe('en-US')
  })

  it('英文 + fallback 覆盖 → 用 fallback', () => {
    expect(detectSpeechLang('Bonjour le monde', 'fr-FR')).toBe('fr-FR')
  })

  it('无字母（纯数字）→ fallback', () => {
    expect(detectSpeechLang('12345', 'fr-FR')).toBe('fr-FR')
  })
})

// ---------- TtsPlayer ----------

describe('TtsPlayer 顺序连播', () => {
  it('按句入队，onend 依次播下一句，播完自动停止', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    const events: boolean[] = []
    player.onStateChange = (p) => events.push(p)

    player.speak('一句。二句。三句。', OPTS)
    expect(player.isPlaying()).toBe(true)
    expect(mock.spoken.map((u) => u.text)).toEqual(['一句。'])

    endUtterance(mock, 0)
    expect(mock.spoken.map((u) => u.text)).toEqual(['一句。', '二句。'])
    expect(player.isPlaying()).toBe(true)

    endUtterance(mock, 1)
    expect(mock.spoken.map((u) => u.text)).toEqual(['一句。', '二句。', '三句。'])

    endUtterance(mock, 2)
    expect(player.isPlaying()).toBe(false)
    expect(mock.spoken.length).toBe(3)
    expect(events).toEqual([true, false])
  })

  it('单句失败（onerror）跳过继续下一句', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.speak('一句。二句。', OPTS)
    mock.spoken[0].onerror?.({})
    expect(mock.spoken.map((u) => u.text)).toEqual(['一句。', '二句。'])
    expect(player.isPlaying()).toBe(true)
  })

  it('语速/音调/音量透传到 utterance', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.speak('Hello.', { rate: 1.5, pitch: 0.8, volume: 0.6 })
    expect(mock.spoken[0].rate).toBe(1.5)
    expect(mock.spoken[0].pitch).toBe(0.8)
    expect(mock.spoken[0].volume).toBe(0.6)
  })

  it('空文本不播放', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.speak('', OPTS)
    player.speak('   ', OPTS)
    expect(player.isPlaying()).toBe(false)
    expect(mock.speak).not.toHaveBeenCalled()
  })
})

describe('TtsPlayer stop / 中断', () => {
  it('stop 清空队列：cancel 被调用，滞留 onend 不再触发下一句', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    const events: boolean[] = []
    player.onStateChange = (p) => events.push(p)

    player.speak('一句。二句。三句。', OPTS)
    mock.cancel.mockClear() // 扣除 speak 内部 stop 的一次 cancel
    player.stop()
    expect(player.isPlaying()).toBe(false)
    expect(mock.cancel).toHaveBeenCalledTimes(1)

    // stop 后迟到抵达的 onend（cancel 异步派发）不得继续连播
    endUtterance(mock, 0)
    expect(mock.spoken.length).toBe(1)
    expect(player.isPlaying()).toBe(false)
    expect(events).toEqual([true, false])
  })

  it('重复 speak 自动中断旧播放：cancel 旧句，只播新队列', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))

    player.speak('旧一。旧二。', OPTS)
    expect(mock.spoken.map((u) => u.text)).toEqual(['旧一。'])

    player.speak('新一。新二。', OPTS)
    expect(mock.cancel).toHaveBeenCalledTimes(2) // 两次 speak 各 stop 一次
    expect(player.isPlaying()).toBe(true)

    // 旧 utterance 的滞留 onend 不得干扰新队列
    endUtterance(mock, 0)
    expect(mock.spoken.map((u) => u.text)).toEqual(['旧一。', '新一。'])

    endUtterance(mock, 1)
    expect(mock.spoken.map((u) => u.text)).toEqual(['旧一。', '新一。', '新二。'])

    endUtterance(mock, 2)
    expect(player.isPlaying()).toBe(false)
  })

  it('未播放时 stop 是幂等空操作', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.stop()
    expect(player.isPlaying()).toBe(false)
    expect(mock.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('TtsPlayer 语种自动判定', () => {
  it.each([
    ['你好世界。', 'zh-CN'],
    ['こんにちは。', 'ja-JP'],
    ['안녕하세요.', 'ko-KR'],
    ['Hello world.', 'en-US'],
  ])('speak(%s) → utterance.lang = %s', (text, expected) => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.speak(text, OPTS)
    expect(mock.spoken[0].lang).toBe(expected)
  })

  it('opts.lang 作为非 CJK 文本的回退', () => {
    const mock = makeSynth()
    const player = new TtsPlayer(asSynth(mock))
    player.speak('Bonjour.', { ...OPTS, lang: 'fr-FR' })
    expect(mock.spoken[0].lang).toBe('fr-FR')
  })
})
