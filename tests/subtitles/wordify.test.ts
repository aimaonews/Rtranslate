import { describe, it, expect } from 'vitest'
import { wordifyText, cleanWord } from '../../src/subtitles/ytRender'

describe('wordifyText', () => {
  it('空串返回空数组', () => {
    expect(wordifyText('')).toEqual([])
  })

  it('基本分词：按空格与标点边界拆分', () => {
    expect(wordifyText('Hello, world!')).toEqual([
      { type: 'word', text: 'Hello' },
      { type: 'sep', text: ', ' },
      { type: 'word', text: 'world' },
      { type: 'sep', text: '!' },
    ])
  })

  it('撇号不拆：don\'t 是一个词', () => {
    expect(wordifyText("I don't know")).toEqual([
      { type: 'word', text: 'I' },
      { type: 'sep', text: ' ' },
      { type: 'word', text: "don't" },
      { type: 'sep', text: ' ' },
      { type: 'word', text: 'know' },
    ])
  })

  it('弯撇号同样不拆', () => {
    const tokens = wordifyText('it’s fine')
    expect(tokens[0]).toEqual({ type: 'word', text: 'it’s' })
  })

  it('连字符不拆：well-known / mother-in-law 各是一个词', () => {
    expect(wordifyText('well-known fact')).toEqual([
      { type: 'word', text: 'well-known' },
      { type: 'sep', text: ' ' },
      { type: 'word', text: 'fact' },
    ])
    const tokens = wordifyText('my mother-in-law')
    expect(tokens[2]).toEqual({ type: 'word', text: 'mother-in-law' })
  })

  it('尾随撇号/连字符不并入单词', () => {
    const tokens = wordifyText("dogs' word-")
    expect(tokens[0]).toEqual({ type: 'word', text: 'dogs' })
    expect(tokens[1]).toEqual({ type: 'sep', text: "' " })
    expect(tokens[2]).toEqual({ type: 'word', text: 'word' })
    expect(tokens[3]).toEqual({ type: 'sep', text: '-' })
  })

  it('CJK 不拆：整段中文落入 sep', () => {
    expect(wordifyText('你好世界')).toEqual([{ type: 'sep', text: '你好世界' }])
  })

  it('日文假名、韩文谚文同样不拆', () => {
    expect(wordifyText('こんにちは')).toEqual([{ type: 'sep', text: 'こんにちは' }])
    expect(wordifyText('안녕하세요')).toEqual([{ type: 'sep', text: '안녕하세요' }])
  })

  it('中英混排：拉丁词拆出，中文保持 sep', () => {
    expect(wordifyText('hello 你好 world')).toEqual([
      { type: 'word', text: 'hello' },
      { type: 'sep', text: ' 你好 ' },
      { type: 'word', text: 'world' },
    ])
  })

  it('token 拼接回原串恒等', () => {
    const samples = [
      "Hello, I don't speak well-known languages!",
      '中英 mixed 混排 123 test',
      '  leading and trailing  ',
      'one',
    ]
    for (const s of samples) {
      expect(
        wordifyText(s)
          .map((t) => t.text)
          .join(''),
      ).toBe(s)
    }
  })

  it('数字与带附标拉丁字母算单词', () => {
    const tokens = wordifyText('café 123')
    expect(tokens[0]).toEqual({ type: 'word', text: 'café' })
    expect(tokens[2]).toEqual({ type: 'word', text: '123' })
  })
})

describe('cleanWord', () => {
  it('去首尾标点', () => {
    expect(cleanWord('"hello",')).toBe('hello')
    expect(cleanWord('(well-known).')).toBe('well-known')
    expect(cleanWord('...word...')).toBe('word')
  })

  it('保留词内撇号与连字符', () => {
    expect(cleanWord("don't")).toBe("don't")
    expect(cleanWord('well-known')).toBe('well-known')
  })

  it('去空白', () => {
    expect(cleanWord('  word  ')).toBe('word')
  })

  it('纯标点返回空串', () => {
    expect(cleanWord('...')).toBe('')
    expect(cleanWord('')).toBe('')
  })
})
