#!/usr/bin/env node
/**
 * 生产启动：由 API 进程同时托管 dist/ 静态资源，只占一个端口。
 * 评委机器上只需要 `npm run build && npm start`。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const isWin = process.platform === 'win32'

if (!existsSync(join(root, 'dist'))) {
  console.error('[start] 未找到 dist/，请先执行：npm run build')
  process.exit(1)
}

const child = spawn(join(root, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx'), ['server/index.ts'], {
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, NODE_ENV: 'production' },
})

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
