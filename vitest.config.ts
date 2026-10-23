import { defineConfig } from 'vitest/config'

// 只跑本项目 tests/，绝不收集 reference/ 下各家参考实现的测试文件
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
