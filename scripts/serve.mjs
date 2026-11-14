#!/usr/bin/env node
/**
 * 一键启动：检查环境 → 装依赖 → 构建 → 后台起服务 → 等健康检查 → 打开浏览器。
 *
 * 用 `node --import tsx server/index.ts` 直接拉起，而不是 `npx tsx`：
 * 后者会多一层子进程，关的时候容易杀不干净、留下孤儿进程占着端口。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/serve.mjs 的上一级就是项目根目录（不要再 dirname，否则会跑到桌面去）
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtimeDir = join(root, '.runtime')
const pidFile = join(runtimeDir, 'server.pid')
const logFile = join(root, 'logs', 'server.log')

const args = process.argv.slice(2)
const NO_OPEN = args.includes('--no-open') || args.includes('-n')
const FORCE_BUILD = args.includes('--rebuild')

const isWin = process.platform === 'win32'

function color(code, text) {
  return process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text
}
const ok = (t) => console.log(`${color('32', '✓')} ${t}`)
const warn = (t) => console.log(`${color('33', '!')} ${t}`)
const fail = (t) => console.error(`${color('31', '✗')} ${t}`)

/** 从 .env 读端口；环境变量优先 */
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
const URL_BASE = `http://127.0.0.1:${PORT}`

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
    const res = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function runStep(label, command, commandArgs) {
  console.log(`\n${color('36', '▸')} ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  })
  if (result.status !== 0) {
    fail(`${label} 失败（退出码 ${result.status}）`)
    process.exit(1)
  }
}

function openBrowser(url) {
  const cmd = isWin ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const cmdArgs = isWin ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', shell: false }).unref()
  } catch {
    warn('没能自动打开浏览器，请手动访问上面的地址')
  }
}

// ── 1. 环境检查 ──────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0])
const minor = Number(process.versions.node.split('.')[1])
if (major < 20 || (major === 20 && minor < 11)) {
  fail(`Node 版本过低：${process.versions.node}，需要 >= 20.11`)
  process.exit(1)
}
ok(`Node ${process.versions.node}`)

// ── 2. 已经在跑就不再启动第二个 ──────────────────────────────────────
const existing = await health()
if (existing) {
  ok(`服务已经在运行：${URL_BASE}`)
  if (!NO_OPEN) openBrowser(URL_BASE)
  process.exit(0)
}
if (await portOpen(PORT)) {
  fail(`端口 ${PORT} 已被其他程序占用`)
  console.log('  换个端口启动：set PORT=4001 && start.bat')
  console.log('  或先执行 stop.bat 看看是不是上一次没关干净')
  process.exit(1)
}

// ── 3. 依赖与构建 ────────────────────────────────────────────────────
if (!existsSync(join(root, 'node_modules'))) {
  warn('首次运行，正在安装依赖（约 30–60 秒）…')
  const hasLock = existsSync(join(root, 'package-lock.json'))
  runStep('安装依赖', 'npm', hasLock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'])
} else {
  ok('依赖已就绪')
}

if (FORCE_BUILD || !existsSync(join(root, 'dist', 'index.html'))) {
  runStep('构建前端', 'npm', ['run', 'build'])
} else {
  ok('前端产物已存在')
}

// ── 4. 启动服务 ──────────────────────────────────────────────────────
mkdirSync(runtimeDir, { recursive: true })
mkdirSync(join(root, 'logs'), { recursive: true })

const log = openSync(logFile, 'a')
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  detached: true,
  windowsHide: true,
  stdio: ['ignore', log, log],
  env: { ...process.env, PORT: String(PORT) },
})
child.unref()

if (!child.pid) {
  fail('启动失败：没有拿到进程号')
  process.exit(1)
}
writeFileSync(pidFile, `${child.pid}\n`, 'utf8')

// ── 5. 等健康检查 ────────────────────────────────────────────────────
console.log(`\n${color('36', '▸')} 等待服务就绪…`)
let info = null
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 500))
  info = await health()
  if (info) break
}

if (!info) {
  fail('服务启动超时，最近日志：')
  try {
    const tail = readFileSync(logFile, 'utf8').split('\n').slice(-12).join('\n')
    console.log(tail)
  } catch {
    console.log('（读不到日志）')
  }
  process.exit(1)
}

const mode = info.mode === 'demo' ? '演示模式（未配置模型接入）' : `在线模式 · ${info.provider} · ${info.model}`
console.log('')
ok(`服务已启动　${color('1', URL_BASE)}`)
ok(`进程 ${child.pid}　存储 ${info.driver}　${mode}`)
console.log(`\n  关闭服务：双击 ${color('36', 'stop.bat')}（或执行 node scripts/stop-server.mjs）`)
console.log(`  运行日志：${logFile}`)
if (info.mode === 'demo') {
  console.log(`  提示：想接真实模型，打开 ${URL_BASE}/#/settings`)
}

if (!NO_OPEN) {
  await new Promise((r) => setTimeout(r, 400))
  openBrowser(URL_BASE)
}
