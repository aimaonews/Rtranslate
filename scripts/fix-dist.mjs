// 把 vite 按输入路径输出的 dist/src/<page>/index.html 归位到 dist/<page>.html
// （html 内引用均为根绝对路径 /xxx.js，移动后仍然有效）
import { renameSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
for (const page of ['popup', 'options', 'review', 'files', 'onboarding']) {
  const from = join(dist, 'src', page, 'index.html')
  const to = join(dist, `${page}.html`)
  if (existsSync(from)) {
    renameSync(from, to)
    console.log(`${page}.html moved to dist root`)
  }
}
const srcDir = join(dist, 'src')
if (existsSync(srcDir)) rmSync(srcDir, { recursive: true, force: true })
