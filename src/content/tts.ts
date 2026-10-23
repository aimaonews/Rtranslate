/**
 * content/tts.ts — TTS 朗读增强：按句切分连播 + 语速/音调/音量控制 + 语种自动判定。
 *
 * 纯 Web Speech API（speechSynthesis），零后台依赖。
 * SpeechSynthesis 通过构造函数注入（测试可 mock），缺省取全局单例。
 * 分句思想复用 core/text.ts 的 splitLongText：先按句末标点切，超长句再硬切；
 * 区别在于 TTS 场景不做贪心合并——每句一个 utterance，靠 onend 串行连播，
 * 规避 Chrome 对超长单条 utterance 的截断/卡死问题。
 */

/** 朗读参数（对应 config.tts，另加可选语种覆盖）。 */
export interface TtsSpeakOpts {
  rate: number
  pitch: number
  volume: number
  /** 非 CJK 文本的语种回退（如 'fr-FR'）；CJK 占比达标时自动判定优先。 */
  lang?: string
}

// 句末标点后可并入前一句的闭引号/闭括号（" " ' ' 」 』 ） ) ] 》 }）
const CLOSERS = '"“”\'‘’」』）)\\]》}'

// 切分规则（思想同 core/text.ts 的 SENTENCE_END，按 TTS 需要调整）：
// - CJK 标点（。！？；）与 ASCII ! ? ; 总是在其后切（CJK 文本句末常无空白）；
// - ASCII 句点只在后跟空白 / 行尾 / CJK 字符时切（避免误切 3.14、example.com、v1.2）；
// - 句末标点后的闭引号/闭括号并入前一句（lookahead 不消费后续文本）。
const SENTENCE_END = new RegExp(
  `([。！？；!?]+[${CLOSERS}]*|\\.+[${CLOSERS}]*(?=[\\s\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af]|$))`,
  'g',
)

/** 超长句硬切窗口内的优选断点：逗号/顿号/逗点（切在其后）。 */
const COMMA_CHARS = [',', '，', '、', ',']

/**
 * 超长句硬切：优先窗口内最后一个逗号/顿号之后，其次最后一个空白之后，
 * 都找不到才定长硬断。保证每段 <= maxLen。
 */
function hardSplitSentence(s: string, maxLen: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen) // 下标 0..maxLen-1，切点最大 maxLen
    let cut = -1
    for (const ch of COMMA_CHARS) cut = Math.max(cut, window.lastIndexOf(ch))
    if (cut > 0) {
      out.push(rest.slice(0, cut + 1)) // 逗号留在段尾，朗读自然停顿
      rest = rest.slice(cut + 1)
      continue
    }
    const ws = window.search(/\s(?![\s\S]*\s)/) // 窗口内最后一个空白的位置
    if (ws > 0) {
      out.push(rest.slice(0, ws + 1))
      rest = rest.slice(ws + 1)
    } else {
      out.push(rest.slice(0, maxLen))
      rest = rest.slice(maxLen)
    }
  }
  if (rest) out.push(rest)
  return out
}

/**
 * 按句末标点把文本切成句子数组（每句一个朗读单元，不做合并）。
 * - 句末标点保留在句尾；闭引号/闭括号随前句；
 * - 超过 maxLen 的句子按逗号/空白硬切（见 hardSplitSentence）；
 * - 各句 trim，空白碎片丢弃；空输入返回 []。
 */
export function splitIntoSentences(text: string, maxLen = 180): string[] {
  if (!text) return []
  const limit = maxLen > 0 ? maxLen : text.length

  // 1) 按句末标点切出句子（保留标点）
  const sentences: string[] = []
  let last = 0
  SENTENCE_END.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SENTENCE_END.exec(text)) !== null) {
    const end = m.index + m[1].length
    sentences.push(text.slice(last, end))
    last = end
  }
  if (last < text.length) sentences.push(text.slice(last))

  // 2) trim + 丢空；超长句硬切
  const out: string[] = []
  for (const raw of sentences) {
    const s = raw.trim()
    if (!s) continue
    if (s.length <= limit) {
      out.push(s)
    } else {
      for (const p of hardSplitSentence(s, limit)) {
        const t = p.trim()
        if (t) out.push(t)
      }
    }
  }
  return out
}

// ===== 语种自动判定 =====

const RE_KANA = /[぀-ヿㇰ-ㇿ]/g // 平假名/片假名/扩展假名
const RE_HANGUL = /[가-힯ᄀ-ᄟ㄰-㆏]/g // 谚文音节/字母/兼容字母
const RE_CJK = /[一-鿿㐀-䶿]/g // 中日韩统一表意文字（基本区 + 扩展 A）
const RE_LETTER = /\p{L}/gu

function countMatches(re: RegExp, s: string): number {
  return s.match(re)?.length ?? 0
}

/**
 * 按文本中 CJK/假名/谚文占全部字母的比例判定朗读语种。
 * - 占比最高的 CJK 家族 >= 30% 时采用之；平手优先假名、其次谚文
 *   （日文为汉字+假名混写，韩文偶夹汉字，纯中文几乎不含假名/谚文）；
 * - 否则回退 fallback（缺省 en-US）。
 */
export function detectSpeechLang(text: string, fallback = 'en-US'): string {
  const letters = countMatches(RE_LETTER, text)
  if (!letters) return fallback
  const kana = countMatches(RE_KANA, text)
  const hangul = countMatches(RE_HANGUL, text)
  const cjk = countMatches(RE_CJK, text)
  const top = Math.max(kana, hangul, cjk)
  if (top / letters < 0.3) return fallback
  if (top === kana) return 'ja-JP'
  if (top === hangul) return 'ko-KR'
  return 'zh-CN'
}

/**
 * 逐句连播播放器。
 * - speak() 按句切分后入队，逐条 utterance 播放，onend 自动播下一句；
 * - 重复 speak 自动 stop 旧播放（cancel + 清队）；
 * - stop() 停止并清空队列；单句播放失败（onerror）跳过继续下一句；
 * - onStateChange 在播放状态翻转时回调（供 UI 切换 朗读/停止）。
 */
export class TtsPlayer {
  private synth: SpeechSynthesis | null
  private queue: string[] = []
  private opts: TtsSpeakOpts = { rate: 1, pitch: 1, volume: 1 }
  private current: SpeechSynthesisUtterance | null = null
  private playing = false
  /** 播放状态变化回调（true=开始播放，false=播完/被停止）。 */
  onStateChange: ((playing: boolean) => void) | null = null

  constructor(synth?: SpeechSynthesis) {
    this.synth = synth ?? null
  }

  private getSynth(): SpeechSynthesis | null {
    if (this.synth) return this.synth
    try {
      return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null
    } catch {
      return null
    }
  }

  isPlaying(): boolean {
    return this.playing
  }

  private setPlaying(v: boolean): void {
    if (this.playing === v) return
    this.playing = v
    try {
      this.onStateChange?.(v)
    } catch {
      // 回调异常不影响播放状态机
    }
  }

  /** 按句切分后顺序连播；重复调用自动中断旧播放。环境不支持时静默不播。 */
  speak(text: string, opts: TtsSpeakOpts): void {
    this.stop()
    const synth = this.getSynth()
    if (!synth) return
    const sentences = splitIntoSentences(text)
    if (!sentences.length) return
    this.queue = sentences
    this.opts = { ...opts }
    this.setPlaying(true)
    this.playNext()
  }

  /** 停止并清空队列（幂等）。 */
  stop(): void {
    this.queue = []
    this.current = null
    const synth = this.getSynth()
    if (synth) {
      try {
        synth.cancel()
      } catch {
        // cancel 异常忽略
      }
    }
    this.setPlaying(false)
  }

  private playNext(): void {
    if (!this.playing) return
    const synth = this.getSynth()
    const sentence = this.queue.shift()
    if (!synth || sentence === undefined) {
      this.current = null
      this.setPlaying(false)
      return
    }
    let u: SpeechSynthesisUtterance
    try {
      u = new SpeechSynthesisUtterance(sentence)
    } catch {
      // 环境不支持 utterance 构造：放弃整次播放
      this.queue = []
      this.current = null
      this.setPlaying(false)
      return
    }
    u.rate = this.opts.rate
    u.pitch = this.opts.pitch
    u.volume = this.opts.volume
    u.lang = detectSpeechLang(sentence, this.opts.lang ?? 'en-US') // 逐句判定，混合文本也能各归其音
    u.onend = () => {
      if (this.current === u) this.playNext()
    }
    u.onerror = () => {
      // 单句失败跳过继续；stop() 引发的 interrupted 因 current===null / playing=false 自然终止
      if (this.current === u) this.playNext()
    }
    this.current = u
    try {
      synth.speak(u)
    } catch {
      if (this.current === u) {
        this.current = null
        this.queue = []
        this.setPlaying(false)
      }
    }
  }
}
