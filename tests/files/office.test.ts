// PPTX / XLSX 解析器闭环测试：JSZip 现造最小 OOXML 文件，
// 验证解析片段数、双语/仅译文回写、重打包后可再解析。
import { describe, expect, it } from 'vitest'
import { JSZip } from '../../src/files/parsers/jszip'
import { pptxParser } from '../../src/files/parsers/pptx'
import { xlsxParser } from '../../src/files/parsers/xlsx'

/* ------------------------------ 最小 PPTX ------------------------------ */
// 两页幻灯片，故意命名 slide10 / slide2：字典序会把 10 排在 2 前，验证数字序。
const SLIDE2_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:bodyPr/>
<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Hello world</a:t></a:r></a:p>
<a:p><a:r><a:t>Fish &amp; Chips</a:t></a:r><a:r><a:t> dinner</a:t></a:r></a:p>
<a:p><a:r><a:t>12345</a:t></a:r></a:p>
<a:p/>
</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

const SLIDE10_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:bodyPr/>
<a:p><a:r><a:t>另一页标题</a:t></a:r></a:p>
<a:p><a:r><a:t>第一行</a:t></a:r><a:br/><a:r><a:t>第二行</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

async function makePptx(): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('ppt/slides/slide10.xml', SLIDE10_XML)
  zip.file('ppt/slides/slide2.xml', SLIDE2_XML)
  return zip.generateAsync({ type: 'arraybuffer' })
}

/* ------------------------------ 最小 XLSX ------------------------------ */
const SHARED_STRINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Hello world</t></si>
<si><r><rPr><b/></rPr><t>Rich</t></r><r><t> text item</t></r></si>
<si><t xml:space="preserve">Fish &amp; Chips</t></si>
<si><t>42</t></si>
</sst>`

async function makeXlsx(sharedStrings: string | null = SHARED_STRINGS_XML): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
  if (sharedStrings !== null) zip.file('xl/sharedStrings.xml', sharedStrings)
  return zip.generateAsync({ type: 'arraybuffer' })
}

async function reparse(blob: Blob, name: string) {
  const parser = name.endsWith('.pptx') ? pptxParser : xlsxParser
  return parser.parse(await blob.arrayBuffer(), name)
}

describe('parser 注册', () => {
  it('pptx / xlsx 路由到对应 parser 且进入 SUPPORTED_EXTS', async () => {
    // parsers/index.ts 连带加载 pdf.ts（顶层用 chrome.runtime.getURL），node 环境先打桩再动态导入
    ;(globalThis as Record<string, unknown>).chrome = { runtime: { getURL: (p: string) => p } }
    const { parserFor, SUPPORTED_EXTS } = await import('../../src/files/parsers')
    expect(parserFor('a.pptx')).toBe(pptxParser)
    expect(parserFor('b.xlsx')).toBe(xlsxParser)
    expect(SUPPORTED_EXTS).toContain('pptx')
    expect(SUPPORTED_EXTS).toContain('xlsx')
  })
})

describe('pptxParser', () => {
  it('解析：幻灯片按数字序，段落聚合 <a:t>，反转义，<a:br/>→\\n，过滤无意义文本', async () => {
    const doc = await pptxParser.parse(await makePptx(), 'demo.pptx')
    expect(doc.kind).toBe('pptx')
    expect(doc.baseName).toBe('demo')
    // slide2 的 2 段在前（12345 被过滤、空段落跳过），slide10 的 2 段在后
    expect(doc.segments.map((s) => s.text)).toEqual([
      'Hello world',
      'Fish & Chips dinner',
      '另一页标题',
      '第一行\n第二行',
    ])
    expect(doc.segments.map((s) => s.id)).toEqual([0, 1, 2, 3])
  })

  it('build 仅译文：替换首个 <a:t>、清空其余，重打包后可再解析出译文', async () => {
    const doc = await pptxParser.parse(await makePptx(), 'demo.pptx')
    const translations = new Map<number, string>([
      [0, '你好 <世界> & 大家'],
      [1, '炸鱼薯条晚餐'],
      [2, '第二页标题'],
      [3, 'Line A\nLine B'],
    ])
    const built = await pptxParser.build(doc, translations, 'translationOnly')
    expect(built.filename).toBe('demo_已翻译.pptx')

    const again = await reparse(built.blob, 'demo.pptx')
    expect(again.segments.map((s) => s.text)).toEqual([
      '你好 <世界> & 大家',
      '炸鱼薯条晚餐',
      '第二页标题',
      'Line A\nLine B',
    ])
  })

  it('build 双语：原段落后插入译文副本段落，再解析得到交错序列', async () => {
    const doc = await pptxParser.parse(await makePptx(), 'demo.pptx')
    const translations = new Map<number, string>([
      [0, '你好世界'],
      [1, '炸鱼薯条晚餐'],
      [2, '第二页标题'],
      [3, '第一行译\n第二行译'],
    ])
    const built = await pptxParser.build(doc, translations, 'bilingual')
    const again = await reparse(built.blob, 'demo.pptx')
    expect(again.segments.map((s) => s.text)).toEqual([
      'Hello world',
      '你好世界',
      'Fish & Chips dinner',
      '炸鱼薯条晚餐',
      '另一页标题',
      '第二页标题',
      '第一行\n第二行',
      '第一行译\n第二行译',
    ])
  })

  it('缺失的译文 id 保留原文', async () => {
    const doc = await pptxParser.parse(await makePptx(), 'demo.pptx')
    const built = await pptxParser.build(doc, new Map([[0, '你好世界']]), 'translationOnly')
    const again = await reparse(built.blob, 'demo.pptx')
    expect(again.segments.map((s) => s.text)).toEqual([
      '你好世界',
      'Fish & Chips dinner',
      '另一页标题',
      '第一行\n第二行',
    ])
  })

  it('没有幻灯片时报错', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', '<p:p xmlns:p="x"/>')
    await expect(pptxParser.parse(await zip.generateAsync({ type: 'arraybuffer' }), 'x.pptx')).rejects.toThrow(
      'slide',
    )
  })
})

describe('xlsxParser', () => {
  it('解析：<si> 聚合（含富文本 run），反转义，过滤无意义文本', async () => {
    const doc = await xlsxParser.parse(await makeXlsx(), 'book.xlsx')
    expect(doc.kind).toBe('xlsx')
    expect(doc.baseName).toBe('book')
    // 3 个有效项（42 被过滤）
    expect(doc.segments.map((s) => s.text)).toEqual(['Hello world', 'Rich text item', 'Fish & Chips'])
    expect(doc.segments.map((s) => s.id)).toEqual([0, 1, 2])
  })

  it('build 仅译文：写回第一个 <t>，重打包后可再解析出译文', async () => {
    const doc = await xlsxParser.parse(await makeXlsx(), 'book.xlsx')
    const translations = new Map<number, string>([
      [0, '你好 <世界> & 大家'],
      [1, '富文本条目'],
      [2, '炸鱼薯条'],
    ])
    const built = await xlsxParser.build(doc, translations, 'translationOnly')
    expect(built.filename).toBe('book_已翻译.xlsx')

    const again = await reparse(built.blob, 'book.xlsx')
    expect(again.segments.map((s) => s.text)).toEqual(['你好 <世界> & 大家', '富文本条目', '炸鱼薯条'])
  })

  it('build 双语：值变为「原值 | 译文」', async () => {
    const doc = await xlsxParser.parse(await makeXlsx(), 'book.xlsx')
    const translations = new Map<number, string>([
      [0, '你好世界'],
      [1, '富文本条目'],
      [2, '炸鱼薯条'],
    ])
    const built = await xlsxParser.build(doc, translations, 'bilingual')
    const again = await reparse(built.blob, 'book.xlsx')
    expect(again.segments.map((s) => s.text)).toEqual([
      'Hello world | 你好世界',
      'Rich text item | 富文本条目',
      'Fish & Chips | 炸鱼薯条',
    ])
  })

  it('缺失的译文 id 保留原文', async () => {
    const doc = await xlsxParser.parse(await makeXlsx(), 'book.xlsx')
    const built = await xlsxParser.build(doc, new Map([[1, '富文本条目']]), 'translationOnly')
    const again = await reparse(built.blob, 'book.xlsx')
    expect(again.segments.map((s) => s.text)).toEqual(['Hello world', '富文本条目', 'Fish & Chips'])
  })

  it('无 sharedStrings.xml 时报「该文件无可翻译文本」', async () => {
    await expect(xlsxParser.parse(await makeXlsx(null), 'empty.xlsx')).rejects.toThrow('该文件无可翻译文本')
  })

  it('sharedStrings 中无可翻译文本时报错', async () => {
    const xml = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>42</t></si></sst>'
    await expect(xlsxParser.parse(await makeXlsx(xml), 'nums.xlsx')).rejects.toThrow('该文件无可翻译文本')
  })
})
