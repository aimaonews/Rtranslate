import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// 字幕翻译内容脚本（YouTube/会议站点），单文件 IIFE
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/subtitles/index.ts'),
      formats: ['iife'],
      name: 'TVSubtitles',
      fileName: () => 'subtitles.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
