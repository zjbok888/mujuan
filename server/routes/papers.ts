import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { generateRequestSchema, questionSchema, paperSchema } from '../../shared/ir.js'
import { SSE_HEADERS, encodeSse, type ServerEvent } from '../../shared/events.js'
import type { AppConfig } from '../config.js'
import { LlmError, streamChat } from '../infra/llm.js'
import { createRateLimiter } from '../infra/rate-limit.js'
import type { PaperRepo } from '../infra/repo.js'
import { clampMixToDemo, loadDemoPaper } from '../infra/demo.js'
import { getProvider, isDemo } from '../settings.js'
import { generatePaper, type LlmPort } from '../domain/generator.js'

export interface RouteDeps {
  config: AppConfig
  repo: PaperRepo
  /** 生成入口：真实模式走模型，演示模式走回放 */
  makeLlmPort: (signal: AbortSignal) => LlmPort
}

const questionPatchSchema = z.object({
  stem: z.string().min(1).max(2000).optional(),
  options: questionSchema.shape.options.optional(),
  answers: questionSchema.shape.answers.optional(),
  keywordRubric: questionSchema.shape.keywordRubric.optional(),
  score: z.number().positive().max(100).optional(),
  explanation: z.string().max(2000).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  knowledgePoints: z.array(z.string().min(1).max(40)).max(6).optional(),
})

const attemptBodySchema = z.object({
  paperId: z.string().min(1).max(64),
  student: z.string().min(1).max(40),
  answers: z.record(z.string(), z.array(z.string().max(2000)).max(8)),
})

export function registerPaperRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, repo } = deps
  const allowGenerate = createRateLimiter(6, 60_000)

  app.get('/api/health', async () => {
    const provider = getProvider()
    const demo = isDemo()
    return {
      ok: true,
      mode: demo ? 'demo' : 'live',
      driver: repo.driver,
      provider: provider.kind,
      model: demo ? 'fixture-replay' : provider.model,
      version: '0.1.0',
    }
  })

  // ── 生成：SSE 长连接 ────────────────────────────────────────────────
  app.post('/api/papers/generate', async (request, reply) => {
    const parsed = generateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: '请求参数不合法',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    if (!allowGenerate(request.ip)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', message: '生成过于频繁，请稍后再试' })
    }

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, SSE_HEADERS)

    const controller = new AbortController()
    // 注意：request.raw 的 close 在「请求体读完」时就会触发，用它检测断连会让流立刻自杀。
    // 真正代表客户端断开的是响应端的 close，且以 writableEnded 区分正常结束。
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })

    const emit = (event: ServerEvent): void => {
      if (!res.writableEnded) res.write(encodeSse(event))
    }

    try {
      let request = parsed.data
      if (isDemo()) {
        // 演示模式下把题型配比收窄到内置样例能覆盖的范围，避免评委改个参数就得到一份自相矛盾的卷子
        const demo = loadDemoPaper()
        const clamped = clampMixToDemo(request.mix, demo)
        if (JSON.stringify(clamped) !== JSON.stringify(request.mix)) {
          request = { ...request, mix: clamped }
          emit({ type: 'reasoning.delta', text: '（演示模式：题型配比已对齐到内置样例的可用题量）' })
        }
      }

      const { ir, issues } = await generatePaper({
        req: request,
        llm: deps.makeLlmPort(controller.signal),
        emit,
        modelName: isDemo() ? 'fixture-replay' : getProvider().model,
        signal: controller.signal,
      })
      const record = await repo.createPaper(ir)
      emit({ type: 'paper.done', paperId: record.id, paper: ir })
      if (issues.length > 0) {
        emit({
          type: 'error',
          code: 'PARTIAL',
          message: `有 ${issues.length} 处校验未通过，相关题目已标记为「待复核」`,
        })
      }
    } catch (error) {
      const code = error instanceof LlmError ? error.code : 'INTERNAL'
      const message = error instanceof Error ? error.message : '生成失败'
      emit({ type: 'error', code, message })
    } finally {
      emit({ type: 'done' })
      res.end()
    }
  })

  // ── 试卷 CRUD ──────────────────────────────────────────────────────
  app.get('/api/papers', async () => ({ items: await repo.listPapers() }))

  app.get<{ Params: { id: string } }>('/api/papers/:id', async (request, reply) => {
    const record = await repo.getPaper(request.params.id)
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    const attempts = await repo.listAttempts(record.id)
    return {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt,
      paper: record.ir,
      attempts: attempts.length,
    }
  })

  app.patch<{ Params: { id: string; qid: string } }>(
    '/api/papers/:id/questions/:qid',
    async (request, reply) => {
      const parsed = questionPatchSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: '题目字段不合法' })
      }
      const question = await repo.updateQuestion(request.params.id, request.params.qid, parsed.data)
      if (!question) return reply.code(404).send({ error: 'NOT_FOUND', message: '题目不存在' })

      // 改题可能破坏"分值合计 = 总分"这类全局不变量，必须当场告知而不是等导出时才发现
      const record = await repo.getPaper(request.params.id)
      const { validatePaper } = await import('../domain/validator.js')
      const issues = record ? validatePaper(record.ir) : []
      return { question, issues }
    },
  )

  app.post<{ Params: { id: string } }>('/api/papers/:id/publish', async (request, reply) => {
    const ok = await repo.setStatus(request.params.id, 'published')
    if (!ok) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    return { ok: true, status: 'published' }
  })

  app.post<{ Params: { id: string } }>('/api/papers/:id/unpublish', async (request, reply) => {
    const ok = await repo.setStatus(request.params.id, 'draft')
    if (!ok) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    return { ok: true, status: 'draft' }
  })

  app.delete<{ Params: { id: string } }>('/api/papers/:id', async (request, reply) => {
    const ok = await repo.deletePaper(request.params.id)
    if (!ok) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    return { ok: true }
  })

  // ── 导出：IR 原件，供二次加工或留档 ─────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/papers/:id/paper.json', async (request, reply) => {
    const record = await repo.getPaper(request.params.id)
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    const validated = paperSchema.safeParse(record.ir)
    if (!validated.success) {
      return reply.code(500).send({ error: 'INVALID_IR', message: '试卷结构已损坏' })
    }
    reply.header('Content-Disposition', `attachment; filename="${record.id}.paper.json"`)
    return reply.type('application/json; charset=utf-8').send(record.ir)
  })

  // ── 作答复用：提交 ────────────────────────────────────────────────
  app.post('/api/attempts', async (request, reply) => {
    const parsed = attemptBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '作答数据不合法' })
    }
    const record = await repo.getPaper(parsed.data.paperId)
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })

    // 草稿也允许试答：老师需要在发布前自己走一遍。
    // 这类提交标记为 preview——入库、可回看，但不计入学情统计。
    const preview = record.status !== 'published'

    const { gradePaper } = await import('../domain/grader.js')
    const result = gradePaper(record.ir, parsed.data.answers)
    const attempt = await repo.createAttempt({
      paperId: record.id,
      student: parsed.data.student,
      score: result.score,
      maxScore: result.maxScore,
      preview,
      result,
    })
    return { attemptId: attempt.id, score: result.score, maxScore: result.maxScore, preview, result }
  })
}
