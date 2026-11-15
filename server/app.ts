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
import { registerAuthRoutes } from './routes/auth.js'
import { currentUser } from './auth/session.js'

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
    // 两端都告诉对方端口：登录页要能引导"走错端"的人
    peerPort: role === 'teacher' ? config.studentPort : config.port,
    ...(role === 'teacher' ? { studentPort: config.studentPort } : {}),
  }))

  // ── 鉴权：除了健康检查与登录本身，所有 /api 都必须带本端角色的会话 ──
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url
    if (!url.startsWith('/api/')) return // 静态资源与登录页放行
    if (url === '/api/health' || url.startsWith('/api/auth/')) return

    const user = currentUser(request)
    if (!user) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '请先登录' })
    }
    if (user.role !== role) {
      return reply.code(403).send({ error: 'WRONG_ROLE', message: '当前端口不接受该角色账号' })
    }
  })

  registerAuthRoutes(app, {
    role,
    peerPort: role === 'teacher' ? config.studentPort : config.port,
  })

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
    /**
     * 每次请求都读盘注入角色，**不能缓存**：
     * 构建后文件名带新哈希，缓存住旧 HTML 会让 /assets/* 全部 404，整站白屏。
     * 文件只有几百字节，重读的代价可以忽略。
     */
    app.get('/', async (_request, reply) => {
      const html = readFileSync(indexFile, 'utf8').replace(
        '</head>',
        `<script>window.__MJUAN_ROLE__=${JSON.stringify(role)}</script></head>`,
      )
      return reply.type('text/html; charset=utf-8').send(html)
    })
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
