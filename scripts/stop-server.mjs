#!/usr/bin/env node
/**
 * 一键停止：按 pid 文件精确定位进程，不误伤机器上其他 node。
 *
 * 判定顺序：pid 文件 → 健康检查确认是本项目 → 结束进程树 → 等端口释放。
 * 顺手清掉陈旧的 pid 文件。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pidFile = join(root, '.runtime', 'server.pid')
const isWin = process.platform === 'win32'

const color = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text)
const ok = (t) => console.log(`${color('32', '✓')} ${t}`)
const warn = (t) => console.log(`${color('33', '!')} ${t}`)
const fail = (t) => console.error(`${color('31', '✗')} ${t}`)

function resolvePort() {
  if (process.env.PORT) return Number(process.env.PORT)
  const envFile = join(root, '.env')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = /^\s*PORT\s*=\s*(\d+)\s*$/.exec(line)
      if (match) return Number(match[1])
    }
  }
  return 4000
}

const PORT = resolvePort()
const STUDENT_PORT = Number(process.env.STUDENT_PORT ?? PORT + 1)

function portOpen(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTree(pid) {
  if (isWin) {
    // /T 结束子进程，/F 强制；避免 tsx 夹一层时留下孤儿
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return result.status === 0
  }
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

if (!existsSync(pidFile)) {
  const info = await health()
  if (info) {
    warn(`服务在 ${PORT} 端口上运行，但不是本脚本启动的（没有 pid 文件）`)
    console.log('  可以在任务管理器里结束对应的 node 进程。')
  } else {
    ok('服务没有在运行')
  }
  process.exit(0)
}

const pidText = readFileSync(pidFile, 'utf8').trim()
const pid = Number(pidText)

if (!Number.isInteger(pid) || pid <= 0) {
  warn('pid 文件内容无效，已清理')
  rmSync(pidFile, { force: true })
  process.exit(0)
}

if (!alive(pid)) {
  warn(`pid ${pid} 已经不存在（可能是上次异常退出），已清理 pid 文件`)
  rmSync(pidFile, { force: true })
  process.exit(0)
}

const info = await health()
if (info) {
  console.log(`正在停止：pid ${pid}　端口 ${PORT}`)
} else {
  warn('进程还在，但健康检查无响应（可能在启动中或卡死），仍尝试结束')
}

if (!killTree(pid)) {
  fail(`结束进程 ${pid} 失败，可能需要管理员权限`)
  process.exit(1)
}

for (let i = 0; i < 20; i += 1) {
  await new Promise((r) => setTimeout(r, 250))
  if (!(await portOpen(PORT)) && !(await portOpen(STUDENT_PORT))) break
}

if ((await portOpen(PORT)) || (await portOpen(STUDENT_PORT))) {
  fail(`进程已结束，但端口 ${PORT} / ${STUDENT_PORT} 仍被占用，请检查是否有其他实例`)
  process.exit(1)
}

rmSync(pidFile, { force: true })
ok('服务已停止')
