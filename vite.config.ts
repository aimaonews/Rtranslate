import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// background (module SW) + popup/options/review 页面；public/ 拷贝 manifest/icons/content.css
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        review: resolve(__dirname, 'src/review/index.html'),
        files: resolve(__dirname, 'src/files/index.html'),
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        privacy: resolve(__dirname, 'src/privacy/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        format: 'es',
      },
    },
  },
})
