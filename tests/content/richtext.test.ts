// @vitest-environment jsdom
// 重灾区 #3：行内富文本标签保留 —— KISS 式 <aN> 配对占位协议的序列化/还原闭环测试。
import { describe, expect, it } from 'vitest'
import { extractText, buildTranslationHtml } from '../../src/content/dom'
import type { InlineTagInfo } from '../../src/content/dom'

/** 把 HTML 片段挂到 body 上并返回第一个元素（extractText 需要真实 DOM） */
function make(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild as Element
}

function tagInfo(r: { placeholders: Map<string, unknown> }, key: string): InlineTagInfo {
  return r.placeholders.get(key) as InlineTagInfo
}

describe('extractText 序列化：<aN> 行内配对占位', () => {
  it('链接段落：生成 <a1>内容</a1>，A 标签存 href', () => {
    const p = make('<p>点击 <a href="https://example.com">这里</a> 查看详情</p>')
    const r = extractText(p)
    expect(r).not.toBeNull()
    expect(r!.text).toBe('点击 <a1>这里</a1> 查看详情')
    expect(tagInfo(r!, 'a1')).toEqual({ tag: 'a', href: 'https://example.com' })
  })

  it('加粗/斜体等非 A 标签：存 outerHTML 开闭包装', () => {
    const p = make('<p>这是 <strong>重点</strong> 与 <em>强调</em></p>')
    const r = extractText(p)!
    expect(r.text).toBe('这是 <a1>重点</a1> 与 <a2>强调</a2>')
    expect(tagInfo(r, 'a1')).toEqual({ tag: 'strong', openTag: '<strong>', closeTag: '</strong>' })
    expect(tagInfo(r, 'a2')).toEqual({ tag: 'em', openTag: '<em>', closeTag: '</em>' })
  })

  it('嵌套行内标签：外层 a1 内层 a2 递增编号', () => {
    const p = make('<p><strong>加粗 <em>斜体</em> 尾巴</strong> 普通</p>')
    const r = extractText(p)!
    expect(r.text).toBe('<a1>加粗 <a2>斜体</a2> 尾巴</a1> 普通')
    expect(tagInfo(r, 'a1').tag).toBe('strong')
    expect(tagInfo(r, 'a2').tag).toBe('em')
  })

  it('code 占位 {{n}} 与行内 <aN> 共存、编号互不干扰', () => {
    const p = make('<p>运行 <code>npm i</code> 后看 <a href="https://x.dev">文档</a> 与 <code>npm run</code></p>')
    const r = extractText(p)!
    expect(r.text).toBe('运行 {{1}} 后看 <a1>文档</a1> 与 {{2}}')
    expect(r.placeholders.get('1')).toBe('<code>npm i</code>')
    expect(r.placeholders.get('2')).toBe('<code>npm run</code>')
    expect(tagInfo(r, 'a1')).toEqual({ tag: 'a', href: 'https://x.dev' })
  })

  it('空行内元素不占位；无 href 的 A 也占位（href 缺省）', () => {
    const p = make('<p>甲 <span></span> 乙 <a>锚点</a></p>')
    const r = extractText(p)!
    expect(r.text).toBe('甲 乙 <a1>锚点</a1>')
    expect(tagInfo(r, 'a1')).toEqual({ tag: 'a', href: undefined })
  })

  it('BR 仍序列化为 \\n，块级子元素仍不下钻', () => {
    const p = make('<p>第一行<br>第二行</p><div><p>内层段落</p></div>')
    // 注意：make 只返回第一个 <p>
    const r = extractText(p)!
    expect(r.text).toBe('第一行\n第二行')
  })
})

describe('buildTranslationHtml 还原：配对标签 → 真实 HTML', () => {
  it('链接存活：重建 <a href target=_blank rel=noopener>', () => {
    const p = make('<p>点击 <a href="https://example.com">这里</a> 查看详情</p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click <a1>here</a1> for details', r.placeholders)
    expect(html).toBe('Click <a href="https://example.com" target="_blank" rel="noopener">here</a> for details')
  })

  it('容错：引擎改大小写（<A1></A1>）也能还原', () => {
    const p = make('<p>看 <a href="https://example.com">链接</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('See <A1>the link</A1>', r.placeholders)
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('>the link</a>')
  })

  it('容错：引擎二次转义（&lt;a1&gt;）也能还原', () => {
    const p = make('<p>看 <a href="https://example.com">链接</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('See &lt;a1&gt;the link&lt;/a1&gt;', r.placeholders)
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('>the link</a>')
  })

  it('容错：引擎在标签内插入空白（< a1 >）也能还原', () => {
    const p = make('<p>看 <a href="https://example.com">链接</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('See < a1 >the link< /a1 >', r.placeholders)
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('>the link</a>')
  })

  it('容错：丢失闭合标签时丢弃包装、只留文本（无悬空 <a>）', () => {
    const p = make('<p>点击 <a href="https://example.com">这里</a> 查看</p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click <a1>here for details', r.placeholders)
    expect(html).not.toContain('<a')
    expect(html).toContain('Click here for details')
  })

  it('容错：丢失开启标签时多余闭合被丢弃', () => {
    const p = make('<p>点击 <a href="https://example.com">这里</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click here</a1> now', r.placeholders)
    expect(html).not.toContain('</a>')
    expect(html).toContain('Click here now')
  })

  it('容错：自闭合占位 <a1/> 被丢弃', () => {
    const p = make('<p>点击 <a href="https://example.com">这里</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click <a1/>here now', r.placeholders)
    expect(html).not.toContain('<a')
    expect(html).toContain('Click here now')
  })

  it('乱序：两个链接在译文中交换位置仍各自还原正确 href', () => {
    const p = make('<p><a href="https://a.dev">甲</a> 和 <a href="https://b.dev">乙</a></p>')
    const r = extractText(p)!
    expect(r.text).toBe('<a1>甲</a1> 和 <a2>乙</a2>')
    const html = buildTranslationHtml('<a2>Second</a2> and <a1>First</a1>', r.placeholders)
    expect(html).toBe(
      '<a href="https://b.dev" target="_blank" rel="noopener">Second</a> and ' +
      '<a href="https://a.dev" target="_blank" rel="noopener">First</a>',
    )
  })

  it('嵌套还原：<strong> 内包 <em>', () => {
    const p = make('<p><strong>加粗 <em>斜体</em> 尾巴</strong> 普通</p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('<a1>bold <a2>em</a2> tail</a1> normal', r.placeholders)
    expect(html).toBe('<strong>bold <em>em</em> tail</strong> normal')
  })

  it('code 占位共存：{{n}} 与 <aN> 同段还原', () => {
    const p = make('<p>运行 <code>npm i</code> 后看 <a href="https://x.dev">文档</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Run {{1}} then read <a1>the docs</a1>', r.placeholders)
    expect(html).toBe(
      'Run <code>npm i</code> then read ' +
      '<a href="https://x.dev" target="_blank" rel="noopener">the docs</a>',
    )
  })
})

describe('buildTranslationHtml 安全：白名单迁移', () => {
  it('恶意 href（javascript:）被剔除，元素保留但无 href', () => {
    const p = make('<p><a href="javascript:alert(1)">点我</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click <a1>me</a1>', r.placeholders)
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('href')
    expect(html).toContain('me</a>')
  })

  it('混淆恶意 href（java\\tscript:）同样被剔除', () => {
    const p = make('<p><a href="java\tscript:alert(1)">点我</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Click <a1>me</a1>', r.placeholders)
    expect(html).not.toContain('script:')
    expect(html).not.toContain('href')
  })

  it('mailto 与相对链接放行', () => {
    const p = make('<p><a href="mailto:a@b.com">邮件</a> <a href="/docs/x">相对</a></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('<a1>Mail</a1> <a2>Rel</a2>', r.placeholders)
    expect(html).toContain('href="mailto:a@b.com"')
    expect(html).toContain('href="/docs/x"')
  })

  it('非 A 标签的事件属性被剥离（onmouseover 不存活）', () => {
    const p = make('<p><span style="color:red" onmouseover="evil()">红字</span></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('<a1>red text</a1>', r.placeholders)
    expect(html).toBe('<span>red text</span>')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('color:red')
  })

  it('译文整体转义：引擎返回的 <script> 被中和为文本', () => {
    const p = make('<p>你好 <strong>世界</strong></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Hi <a1>world</a1> <script>alert(1)</script>', r.placeholders)
    expect(html).toContain('<strong>world</strong>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('编号未知的占位（引擎幻觉 <a9>）被丢弃', () => {
    const p = make('<p>你好 <strong>世界</strong></p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('Hi <a9>ghost</a9> <a1>world</a1>', r.placeholders)
    expect(html).not.toContain('<a9>')
    expect(html).toContain('ghost')
    expect(html).toContain('<strong>world</strong>')
  })

  it('换行 \\n 仍还原为 <br>', () => {
    const p = make('<p>第一行<br>第二行</p>')
    const r = extractText(p)!
    const html = buildTranslationHtml('line one\nline two', r.placeholders)
    expect(html).toBe('line one<br>line two')
  })
})
