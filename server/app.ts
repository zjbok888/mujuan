import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { AppConfig } from './config.js'
import type { PaperRepo } from './infra/repo.js'
import { createDemoPort, loadDemoPaper } from './infra/demo.js'
import { streamChat } from './infra/llm.js'
import type { LlmPort } from './domain/generator.js'
import { registerPaperRoutes } from './routes/papers.js'
import { registerStatsRoutes } from './routes/stats.js'

export interface AppDeps {
  config: AppConfig
  repo: PaperRepo
}

function createLivePort(config: AppConfig): LlmPort {
  return (messages, options) =>
    streamChat(config.llm, {
      messages,
      json: options.json,
      signal: options.signal,
      onReasoning: options.onReasoning,
      maxTokens: options.maxTokens,
    })
}

function createDemoFactory(config: AppConfig): () => LlmPort {
  let cached: LlmPort | null = null
  // 演示节奏可调：录屏/截图时放慢，答辩现场保持默认
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
  const { config } = deps
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
  })

  const demoFactory = config.demoMode ? createDemoFactory(config) : null
  const makeLlmPort = (_signal: AbortSignal): LlmPort =>
    demoFactory ? demoFactory() : createLivePort(config)

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

  registerPaperRoutes(app, { config, repo: deps.repo, makeLlmPort })
  registerStatsRoutes(app, { config, repo: deps.repo, makeLlmPort })

  if (existsSync(config.webDist)) {
    // 不要关掉 wildcard：关掉之后只有 "/" 能被服务，/assets/* 全部 404，页面白屏
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' })
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/html; charset=utf-8').send(
        `<!doctype html><meta charset="utf-8"><title>墨卷</title>
         <body style="font-family:system-ui;padding:48px;line-height:1.8;background:#f7f4ee;color:#1a1a1a">
         <h1 style="font-size:20px">墨卷 API 已启动</h1>
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
    return reply.code(404).send({ error: 'NOT_FOUND', message: '页面不存在' })
  })

  return app
}
