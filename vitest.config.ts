import { defineConfig } from 'vitest/config'

/**
 * 独立于 vite.config.ts：后者把 root 指向 web/，会让 vitest 找不到 tests/。
 * 单测只覆盖纯函数层（IR、校验、评分、统计、分值分配），不碰网络与数据库。
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
})
