#!/usr/bin/env node
/**
 * 用 Chrome DevTools Protocol 给指定 URL 截一张图。
 * 存在的理由：用 --screenshot 拿不到 SPA 的渲染结果，而这个脚本能等到 load 之后再多等一会儿。
 *
 * 用法：node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, out, w = '1280', h = '900', waitMs = '1600'] = process.argv.slice(2)
if (!url || !out) {
  console.error('用法：node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]')
  process.exit(1)
}

const chromeCandidates = [
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
]
const chrome = chromeCandidates.find((p) => p && existsSync(p))
if (!chrome) {
  console.error('[shot] 未找到 Chrome/Edge')
  process.exit(1)
}

const width = Number(w)
const height = Number(h)
const port = 9333
const profile = mkdtempSync(join(tmpdir(), 'mujuan-shot-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

function cleanup() {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

async function endpoint() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch {
      /* not ready */
    }
    await sleep(120)
  }
  throw new Error('Chrome 调试端口未就绪')
}

const browserWs = await endpoint()

// 直接在浏览器级连接上创建目标，避免 /json/new 的 PUT 兼容问题
const ws = new WebSocket(browserWs)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('CDP 连接失败'))
})

let nextId = 1
const pending = new Map()
const events = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
    return
  }
  if (msg.method) events.push(msg.method)
}

function send(method, params = {}, sessionId) {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify(payload))
  })
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

  await send('Page.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId)
  await send('Page.navigate', { url }, sessionId)

  // 等 load 事件，再多等一会儿让 React 与字体就位
  for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i += 1) await sleep(100)
  await sleep(Number(waitMs))

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`[shot] ${out} (${width}x${height})`)
  await send('Target.closeTarget', { targetId })
} finally {
  try {
    ws.close()
  } catch {
    /* ignore */
  }
  cleanup()
}
