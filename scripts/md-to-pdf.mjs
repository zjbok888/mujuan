#!/usr/bin/env node
/**
 * Markdown → PDF（A4，带页脚页码）。
 * 用 Chrome 的 Page.printToPDF，不引入 pandoc / wkhtmltopdf 这类外部依赖。
 *
 * 用法：node scripts/md-to-pdf.mjs <input.md> <output.pdf>
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { marked } from 'marked'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法：node scripts/md-to-pdf.mjs <input.md> <output.pdf>')
  process.exit(1)
}

const markdown = readFileSync(resolve(input), 'utf8')
const rawHtml = marked.parse(markdown, { gfm: true, async: false })

// 相对路径的图片在临时目录里会失效：统一内联成 data URI
const baseDir = dirname(resolve(input))
const body = rawHtml.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, (tag, src) => {
  if (/^(https?:|data:)/.test(src)) return tag
  const file = resolve(baseDir, src)
  if (!existsSync(file)) return tag
  const ext = extname(file).slice(1).toLowerCase()
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  const data = readFileSync(file).toString('base64')
  return tag.replace(src, `data:${mime};base64,${data}`)
})

const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body {
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  font-size: 10.5pt; line-height: 1.78; color: #1b1916; margin: 0;
  padding: 18mm 16mm 20mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 19pt; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 2px solid #b23a2b; letter-spacing: .02em; }
h2 { font-size: 13.5pt; margin: 24px 0 10px; padding-left: 9px; border-left: 3px solid #b23a2b; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; color: #3d372f; page-break-after: avoid; }
p { margin: 7px 0; text-align: justify; }
strong { color: #000; }
a { color: #8d2c20; text-decoration: none; }
ul, ol { margin: 7px 0; padding-left: 22px; }
li { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9pt; page-break-inside: avoid; }
th, td { border: 1px solid #ddd6c8; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #f3eee4; font-weight: 600; }
code { background: #f4f1ea; padding: 1px 4px; border-radius: 3px; font-size: 8.8pt;
  font-family: "Cascadia Code", "Consolas", monospace; }
pre { background: #f8f5ef; border: 1px solid #e5ded1; border-radius: 4px; padding: 10px 12px;
  overflow: auto; font-size: 8.4pt; line-height: 1.6; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.4pt; }
blockquote { border-left: 3px solid #d8cfbe; color: #4d463c; margin: 10px 0; padding: 2px 0 2px 12px; background: #faf7f1; }
hr { border: none; border-top: 1px solid #e3dacb; margin: 18px 0; }
img { max-width: 100%; border: 1px solid #e3dacb; border-radius: 6px; margin: 10px 0; page-break-inside: avoid; }
`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>${body}</body></html>`

const workdir = mkdtempSync(join(tmpdir(), 'mujuan-pdf-'))
const htmlPath = join(workdir, 'doc.html')
writeFileSync(htmlPath, html, 'utf8')

const chromeCandidates = [
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
]
const chrome = chromeCandidates.find((p) => p && existsSync(p))
if (!chrome) {
  console.error('[pdf] 未找到 Chrome/Edge')
  process.exit(1)
}

const port = 9334
const profile = join(workdir, 'profile')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
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
    rmSync(workdir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

async function wsEndpoint() {
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

const ws = new WebSocket(await wsEndpoint())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('CDP 连接失败'))
})

let nextId = 1
const pending = new Map()
const events = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve: ok, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else ok(msg.result)
  } else if (msg.method) events.push(msg.method)
}

const send = (method, params = {}, sessionId) => {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  return new Promise((ok, reject) => {
    pending.set(id, { resolve: ok, reject })
    ws.send(JSON.stringify(payload))
  })
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId)

  for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i += 1) await sleep(100)
  await sleep(600)

  const { data } = await send(
    'Page.printToPDF',
    {
      printBackground: true,
      format: 'A4',
      marginTop: 0.55,
      marginBottom: 0.65,
      marginLeft: 0,
      marginRight: 0,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#9a9287;text-align:center;font-family:sans-serif;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    },
    sessionId,
  )

  writeFileSync(resolve(output), Buffer.from(data, 'base64'))
  const size = readFileSync(resolve(output)).length
  console.log(`[pdf] ${output}  ${(size / 1024).toFixed(1)} KB`)
  await send('Target.closeTarget', { targetId })
} finally {
  try {
    ws.close()
  } catch {
    /* ignore */
  }
  cleanup()
}
