// 从 node_modules/pdfjs-dist 同步 PDF 运行时资产到 public/（这些第三方资产不入库，构建时自动恢复）
// - build/pdf.worker.min.mjs → public/pdf.worker.min.js（保留 .js 扩展名保证 chrome-extension:// MIME 正确）
// - cmaps/ → public/pdfjs/cmaps（CJK PDF 文本提取所需）
// - standard_fonts/ → public/pdfjs/standard_fonts
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pdfjsDist = join(root, 'node_modules', 'pdfjs-dist')

if (!existsSync(pdfjsDist)) {
  console.error('pdfjs-dist 未安装，请先执行 npm install')
  process.exit(1)
}

const jobs = [
  {
    from: join(pdfjsDist, 'build', 'pdf.worker.min.mjs'),
    to: join(root, 'public', 'pdf.worker.min.js'),
  },
  {
    from: join(pdfjsDist, 'cmaps'),
    to: join(root, 'public', 'pdfjs', 'cmaps'),
  },
  {
    from: join(pdfjsDist, 'standard_fonts'),
    to: join(root, 'public', 'pdfjs', 'standard_fonts'),
  },
]

for (const { from, to } of jobs) {
  if (!existsSync(from)) {
    console.error(`缺少源路径：${from}`)
    process.exit(1)
  }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  const size = statSync(to).isDirectory() ? 'dir' : `${Math.round(statSync(to).size / 1024)}KB`
  console.log(`synced ${to.replace(root, '.')} (${size})`)
}
