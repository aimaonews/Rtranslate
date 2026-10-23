// 生成商店视觉素材：5 张截图（1280×800）+ 小宣传图（440×280）+ 大横幅（1400×560），全部 24 位 RGB 无透明通道
// 运行：node scripts/gen-store-assets.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = join(root, 'scripts', 'e2e', 'audit')
const outShots = join(root, 'store-assets', 'screenshots')
const outPromo = join(root, 'store-assets', 'promo')
mkdirSync(outShots, { recursive: true })
mkdirSync(outPromo, { recursive: true })

const BRAND = '#409eff'
const DARK = '#0f172a'
const LIGHT = '#f7f9fa'

function svgText({ w, h, title, subtitle, titleSize = 44, subSize = 22, color = '#ffffff', subColor = 'rgba(255,255,255,0.85)', align = 'left', x = 64, y = 64 }) {
  const anchor = align === 'center' ? 'middle' : 'start'
  const tx = align === 'center' ? w / 2 : x
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${tx}" y="${y}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif" font-size="${titleSize}" font-weight="700" fill="${color}" text-anchor="${anchor}">${esc(title)}</text>
    ${subtitle ? `<text x="${tx}" y="${y + subSize + 18}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif" font-size="${subSize}" fill="${subColor}" text-anchor="${anchor}">${esc(subtitle)}</text>` : ''}
  </svg>`)
}

function gradient(w, h, c1, c2) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`)
}

// ===== 1. 五张商店截图（1280×800） =====
const SCREENSHOTS = [
  {
    src: '05-page-translated.png',
    out: 'screenshot-1-bilingual.png',
    title: 'Bilingual Page Translation',
    subtitle: 'Read any webpage in two languages at once',
  },
  {
    src: '06-selection-popup.png',
    out: 'screenshot-2-selection.png',
    title: 'Select & Translate Anywhere',
    subtitle: 'Bubble translation with AI insights, wordbook and TTS',
  },
  {
    src: '02-options-engine.png',
    out: 'screenshot-3-engines.png',
    title: '10+ Translation Engines',
    subtitle: 'Free engines out of the box, plus your own AI keys',
  },
  {
    src: '03-review.png',
    out: 'screenshot-4-flashcards.png',
    title: 'Learn While You Read',
    subtitle: 'FSRS flashcard review built into the extension',
  },
  {
    src: '04-files.png',
    out: 'screenshot-5-documents.png',
    title: 'Translate Documents',
    subtitle: 'PDF, EPUB, DOCX, PPTX, XLSX and 7 more formats',
  },
]

for (const s of SCREENSHOTS) {
  const srcPath = join(shots, s.src)
  // 画布：浅灰底 + 顶部品牌蓝条 + 标题 + 居中截图卡片
  const bg = await sharp(gradient(1280, 800, '#eef2f7', '#dbe4f0'))
    .composite([
      { input: gradient(1280, 8, BRAND, '#79bbff'), top: 0, left: 0 },
      { input: svgText({ w: 1280, h: 120, title: s.title, subtitle: s.subtitle, titleSize: 40, subSize: 20, color: DARK, subColor: '#64748b', x: 64, y: 56 }) },
    ])
    .png()
    .toBuffer()
  // 截图卡片：缩放到 1152 宽，白边 + 圆角 + 阴影
  const cardW = 1152
  const shot = await sharp(srcPath).resize({ width: cardW }).png().toBuffer()
  const shotMeta = await sharp(shot).metadata()
  const cardH = shotMeta.height
  const cardTop = 800 - 40 - cardH
  const framed = await sharp({
    create: { width: cardW + 16, height: cardH + 16, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: shot, top: 8, left: 8 }])
    .png()
    .toBuffer()
  await sharp(bg)
    .composite([{ input: framed, top: cardTop - 8, left: (1280 - cardW - 16) / 2 }])
    .removeAlpha()  // 24 位 RGB 无透明通道
    .png({ palette: false })
    .toFile(join(outShots, s.out))
  console.log(s.out)
}

// ===== 2. 小型宣传图块（440×280，全球共用，少文字） =====
{
  const logo = await sharp(join(root, 'public', 'icons', 'icon128.png'))
    .resize(112, 112)
    .png()
    .toBuffer()
  const bg = gradient(440, 280, BRAND, '#1d4ed8')
  const title = svgText({ w: 440, h: 280, title: 'Rtranslate', subtitle: '', titleSize: 44, color: '#ffffff', align: 'center', y: 208 })
  await sharp(bg)
    .composite([
      { input: logo, top: 44, left: (440 - 112) / 2 },
      { input: title, top: 0, left: 0 },
    ])
    .removeAlpha()
    .png({ palette: false })
    .toFile(join(outPromo, 'promo-tile-440x280.png'))
  console.log('promo-tile-440x280.png')
}

// ===== 3. 大型横幅（1400×560，选填） =====
{
  const logo = await sharp(join(root, 'public', 'icons', 'icon128.png'))
    .resize(160, 160)
    .png()
    .toBuffer()
  const bg = gradient(1400, 560, '#0f172a', BRAND)
  const title = svgText({
    w: 1400, h: 560,
    title: 'Rtranslate',
    subtitle: 'Open-source bilingual translation — read any page in two languages',
    titleSize: 72, subSize: 30, color: '#ffffff', subColor: 'rgba(255,255,255,0.85)',
    x: 480, y: 240,
  })
  await sharp(bg)
    .composite([
      { input: logo, top: 200, left: 240 },
      { input: title, top: 0, left: 0 },
    ])
    .removeAlpha()
    .png({ palette: false })
    .toFile(join(outPromo, 'promo-marquee-1400x560.png'))
  console.log('promo-marquee-1400x560.png')
}

console.log('done')
