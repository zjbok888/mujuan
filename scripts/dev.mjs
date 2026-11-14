#!/usr/bin/env node
/**
 * 一键开发环境：同时拉起 API（tsx watch）与前端（vite）。
 * 不依赖 concurrently，避免多加一个依赖；Windows 下用 shell 解析 .cmd。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const isWin = process.platform === 'win32'
const bin = (name) => join(root, 'node_modules', '.bin', isWin ? `${name}.cmd` : name)

if (!existsSync(join(root, 'node_modules'))) {
  console.error('[dev] 未找到 node_modules，请先执行：npm install')
  process.exit(1)
}

const children = []

function run(label, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev] ${label} 退出，退出码 ${code}`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(code), 150)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[dev] API  http://127.0.0.1:4000')
console.log('[dev] Web  http://localhost:5173')

run('api', bin('tsx'), ['watch', 'server/index.ts'])
run('web', bin('vite'), [])
