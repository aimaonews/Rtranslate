// @vitest-environment jsdom
// 快捷键匹配（matchHotkey）测试：组合键、仅修饰键、空串禁用、主键不匹配、Meta/Ctrl 等价。
import { describe, it, expect, beforeAll } from 'vitest'

let matchHotkey: (typeof import('../../src/content/index'))['matchHotkey']

beforeAll(async () => {
  // 跳过 content 入口自举（不跑 main），并 stub 模块顶层用到的 chrome 监听器
  ;(window as unknown as Record<string, unknown>).__TV_CONTENT_INJECTED__ = true
  const g = globalThis as Record<string, unknown>
  g.chrome = {
    storage: { onChanged: { addListener: () => {} } },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({ ok: false, error: 'stub' }),
    },
  }
  ;({ matchHotkey } = await import('../../src/content/index'))
})

interface Mods {
  alt?: boolean
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}

function kev(code: string, mods: Mods = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    code,
    altKey: mods.alt ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  })
}

describe('matchHotkey', () => {
  it("Alt+T：Alt+KeyT 命中", () => {
    expect(matchHotkey(kev('KeyT', { alt: true }), 'Alt+T')).toBe(true)
  })

  it('Alt+T：多按 / 少按修饰键不命中（严格匹配）', () => {
    expect(matchHotkey(kev('KeyT', { alt: true, shift: true }), 'Alt+T')).toBe(false)
    expect(matchHotkey(kev('KeyT', { alt: true, ctrl: true }), 'Alt+T')).toBe(false)
    expect(matchHotkey(kev('KeyT'), 'Alt+T')).toBe(false)
  })

  it('Ctrl+Shift+D：组合命中', () => {
    expect(matchHotkey(kev('KeyD', { ctrl: true, shift: true }), 'Ctrl+Shift+D')).toBe(true)
    expect(matchHotkey(kev('KeyD', { ctrl: true }), 'Ctrl+Shift+D')).toBe(false)
    expect(matchHotkey(kev('KeyD', { ctrl: true, shift: true, alt: true }), 'Ctrl+Shift+D')).toBe(false)
  })

  it("仅修饰键 'Alt'：按下 Alt 本身命中", () => {
    expect(matchHotkey(kev('AltLeft', { alt: true }), 'Alt')).toBe(true)
    expect(matchHotkey(kev('AltRight', { alt: true }), 'Alt')).toBe(true)
  })

  it("仅修饰键 'Alt'：Alt+A 不命中", () => {
    expect(matchHotkey(kev('KeyA', { alt: true }), 'Alt')).toBe(false)
  })

  it("仅修饰键 'Alt'：按下 Ctrl 不命中", () => {
    expect(matchHotkey(kev('ControlLeft', { ctrl: true }), 'Alt')).toBe(false)
  })

  it('空串 = 禁用，永不命中', () => {
    expect(matchHotkey(kev('KeyT', { alt: true }), '')).toBe(false)
    expect(matchHotkey(kev('AltLeft', { alt: true }), '')).toBe(false)
    expect(matchHotkey(kev('KeyT', { alt: true }), '   ')).toBe(false)
  })

  it('主键不匹配不命中', () => {
    expect(matchHotkey(kev('KeyX', { alt: true }), 'Alt+T')).toBe(false)
    expect(matchHotkey(kev('KeyT', { alt: true }), 'Alt+D')).toBe(false)
  })

  it('Mac 上 Meta 与 CTRL 等价：规格 Ctrl 按 Cmd 命中，反之亦然', () => {
    expect(matchHotkey(kev('KeyD', { meta: true, shift: true }), 'Ctrl+Shift+D')).toBe(true)
    expect(matchHotkey(kev('KeyT', { ctrl: true }), 'Meta+T')).toBe(true)
    // 但规格无 Ctrl/Meta 时，多按 Cmd 仍不命中
    expect(matchHotkey(kev('KeyT', { alt: true, meta: true }), 'Alt+T')).toBe(false)
  })

  it('数字键与特殊键：Digit1→1、Space→Space', () => {
    expect(matchHotkey(kev('Digit1', { alt: true }), 'Alt+1')).toBe(true)
    expect(matchHotkey(kev('Space', { ctrl: true }), 'Ctrl+Space')).toBe(true)
  })

  it('规格大小写 / 空白容错', () => {
    expect(matchHotkey(kev('KeyT', { alt: true }), 'alt+t')).toBe(true)
    expect(matchHotkey(kev('KeyT', { alt: true }), ' Alt + T ')).toBe(true)
  })
})
