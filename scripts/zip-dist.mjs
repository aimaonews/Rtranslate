// 只打包 dist/ 内容为商店上传 ZIP（manifest.json 位于压缩包根目录）
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
if (!statSync(dist, { throwIfNoEntry: false })) {
  console.error('dist/ 不存在，请先 npm run build')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version ?? '0.0.0'
const zip = new JSZip()

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else zip.file(relative(dist, p).replace(/\\/g, '/'), readFileSync(p))
  }
}
walk(dist)

const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `rtranslate-${version}.zip`)
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
writeFileSync(out, buf)

// 校验：根目录必须有 manifest.json 且无注释
const check = new JSZip()
await check.loadAsync(buf)
if (!check.file('manifest.json')) {
  console.error('ZIP 根目录缺少 manifest.json！')
  process.exit(1)
}
const manifest = JSON.parse(await check.file('manifest.json').async('string'))
console.log(`OK: ${out}`)
console.log(`  files: ${Object.keys(check.files).length}, manifest: ${manifest.name} v${manifest.version}`)
