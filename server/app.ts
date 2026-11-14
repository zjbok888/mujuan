import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { AppConfig } from './config.js'
import type { PaperRepo } from './infra/repo.js'
import { createDemoPort, loadDemoPaper } from './infra/demo.js'
import { streamChat } from './infra/llm.js'
import type { LlmPort } from './domain/generator.js'
import { getProvider, getTimeoutMs, isDemo } from './settings.js'
import { registerPaperRoutes } from './routes/papers.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAssistantRoutes } from './routes/assistant.js'
import { registerStudentRoutes } from './routes/student.js'
import { registerAttemptRoutes } from './routes/attempts.js'

/**
 * 两个端口 = 两个应用。
 *
 * 教师端和学生端共用一个进程、一个数据库，但**路由面完全分开**：
 * 学生端根本不注册出卷、改题、学情、接入这些路由，所以"学生改卷子"不是靠权限判断挡住的，
 * 是那条路压根不存在。两端的 AI 助手也是两套提示词、两个接口。
 */
export type AppRole = 'teacher' | 'student'

export interface AppDeps {
  config: AppConfig
  repo: PaperRepo
  role: AppRole
}

/**
 * 走真实模型时每次调用都重新读一次配置：
 * 用户在界面上切换接入方式后，不需要重启服务。
 */
function createLivePort(): LlmPort {
  return (messages, options) => {
    const provider = getProvider()
    return streamChat(
      {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        timeoutMs: getTimeoutMs(),
      },
      {
        messages,
        json: options.json,
        signal: options.signal,
        onReasoning: options.onReasoning,
        onContent: options.onContent,
        maxTokens: options.maxTokens,
      },
    )
  }
}

function createDemoFactory(): () => LlmPort {
  let cached: LlmPort | null = null
  const stepMs = Number(process.env.DEMO_STEP_MS ?? 16)
  return () => {
    if (!cached) {
      try {
        cached = createDemoPort(loadDemoPaper(), Number.isFinite(stepMs) ? stepMs : 16)
      } catch (error) {
        throw new Error(
          `演示数据缺失或损坏（fixtures/demo-paper.json）：${(error as Error).message}`,
        )
      }
    }
    return cached
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, role } = deps
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 })

  // 容错：声明了 application/json 但 body 为空时按 {} 处理。
  // 前端只要有一次忘记去掉 header，所有"无 body 的 POST/DELETE"就会整片 400——
  // 与其让每个调用方各自小心，不如在边界上兜住。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (text.length === 0) {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  const demoFactory = createDemoFactory()
  let demoPort: LlmPort | null = null
  const makeLlmPort = (_signal: AbortSignal): LlmPort => {
    if (isDemo()) {
      if (!demoPort) demoPort = demoFactory()
      return demoPort
    }
    return createLivePort()
  }

  const provider = getProvider()
  const demo = isDemo()
  app.get('/api/health', async () => ({
    ok: true,
    role,
    mode: demo ? 'demo' : 'live',
    driver: deps.repo.driver,
    provider: provider.kind,
    model: demo ? 'fixture-replay' : provider.model,
    version: '0.1.0',
    // 教师端要能告诉老师"学生该去哪"——端口是配置出来的，不能让老师自己猜
    ...(role === 'teacher' ? { studentPort: config.studentPort } : {}),
  }))

  // 交卷是两端唯一的共用写接口
  registerAttemptRoutes(app, { repo: deps.repo })

  if (role === 'teacher') {
    registerPaperRoutes(app, { config, repo: deps.repo, makeLlmPort })
    registerStatsRoutes(app, { config, repo: deps.repo, makeLlmPort })
    registerSettingsRoutes(app)
    registerAssistantRoutes(app, { config, repo: deps.repo, makeLlmPort })
  } else {
    registerStudentRoutes(app, { repo: deps.repo, makeLlmPort })
  }

  // ── 静态资源 + 按端注入角色 ────────────────────────────────────────
  const indexFile = join(config.webDist, 'index.html')
  if (existsSync(indexFile)) {
    const html = readFileSync(indexFile, 'utf8')
    // 同一个构建产物，两端各自注入角色，前端据此决定渲染哪一套页面
    const withRole = html.replace(
      '</head>',
      `<script>window.__MJUAN_ROLE__=${JSON.stringify(role)}</script></head>`,
    )
    // 路由优先级：具名 `GET /` 高于静态插件的通配，所以这里能覆盖 index.html
    app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(withRole))
    // 不要关掉 wildcard：关掉之后只有 "/" 能被服务，/assets/* 全部 404，页面白屏
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', index: false })
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/html; charset=utf-8').send(
        `<!doctype html><meta charset="utf-8"><title>墨卷 · ${role}</title>
         <body style="font-family:system-ui;padding:48px;line-height:1.8;background:#f7f4ee;color:#1a1a1a">
         <h1 style="font-size:20px">墨卷 API 已启动（${role === 'teacher' ? '教师端' : '学生端'}）</h1>
         <p>前端构建产物（<code>dist/</code>）不存在。开发模式请访问 <code>http://localhost:5173</code>，
         或先执行 <code>npm run build</code>。</p>
         <p>健康检查：<a href="/api/health">/api/health</a></p></body>`,
      ),
    )
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '接口不存在' })
    }
    // 前端是 hash 路由，未知路径交回首页
    if (existsSync(indexFile) && !request.url.includes('.')) {
      return reply.type('text/html; charset=utf-8').send(readFileSync(indexFile, 'utf8'))
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: '页面不存在' })
  })

  return app
}
