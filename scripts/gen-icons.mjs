// 无依赖生成扩展图标：蓝紫渐变圆角方块 + 白色 "T" 字形
// 运行：node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const r1 = [64, 158, 255], r2 = [121, 187, 255] // AIMAO 蓝 → 浅蓝
  const corner = size * 0.22
  const cx = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // 圆角
      const dx = Math.max(corner - x, x - (size - corner), 0)
      const dy = Math.max(corner - y, y - (size - corner), 0)
      if (dx * dx + dy * dy > corner * corner) continue // 透明
      const t = (x + y) / (2 * size)
      px[i] = lerp(r1[0], r2[0], t)
      px[i + 1] = lerp(r1[1], r2[1], t)
      px[i + 2] = lerp(r1[2], r2[2], t)
      px[i + 3] = 255
      // 白色 T：横杠在上 1/3，竖杠居中
      const bar = size * 0.14
      const stemW = size * 0.15
      const topY = size * 0.26
      const hBar = y >= topY && y <= topY + bar && x >= size * 0.2 && x <= size * 0.8
      const vBar = x >= cx - stemW / 2 && x <= cx + stemW / 2 && y >= topY && y <= size * 0.78
      if (hBar || vBar) {
        px[i] = px[i + 1] = px[i + 2] = 255
      }
    }
  }
  return png(size, size, px)
}

mkdirSync(root, { recursive: true })
for (const size of [16, 48, 128]) {
  const file = join(root, `icon${size}.png`)
  writeFileSync(file, render(size))
  console.log('written', file)
}
