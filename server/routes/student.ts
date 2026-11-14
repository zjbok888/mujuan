import type { FastifyInstance } from 'fastify'
import { assistantChatSchema, encodeAssistantSse, type AssistantEvent } from '../../shared/assistant.js'
import { SSE_HEADERS } from '../../shared/events.js'
import { runStudentTutor } from '../domain/assistant.js'
import type { LlmPort } from '../domain/generator.js'
import { LlmError } from '../infra/llm.js'
import { createRateLimiter } from '../infra/rate-limit.js'
import type { PaperRepo } from '../infra/repo.js'
import { isDemo } from '../settings.js'
import { currentUser } from '../auth/session.js'
import type { PaperIR } from '../../shared/ir.js'

/**
 * 学生端接口。
 *
 * 设计前提：本项目没有账号体系（也不需要——一间教室几十个学生，注册成本比收益高）。
 * 学生身份就是"输入一次名字"，前端存 localStorage，后端按名字聚合。
 * 代价是重名会混在一起；收益是零门槛，符合真实使用场景。
 */
export interface StudentDeps {
  repo: PaperRepo
  makeLlmPort: (signal: AbortSignal) => LlmPort
}

interface StudentPaper {
  id: string
  title: string
  subject: string
  grade: string
  questionCount: number
  totalScore: number
  durationMin: number
  /** 我已经提交过几次 */
  myAttempts: number
  /** 我的最高分；从没做过为 null */
  myBest: { score: number; maxScore: number; attemptId: string } | null
}

export function registerStudentRoutes(app: FastifyInstance, deps: StudentDeps): void {
  const allowAssistant = createRateLimiter(20, 60_000)

  /** 学生能看到的卷子：只有已发布的 */
  app.get<{ Querystring: { student?: string } }>('/api/student/papers', async (request) => {
    // 身份来自会话，不再信任查询参数
    const student = currentUser(request)?.displayName ?? ''
    const papers = (await deps.repo.listPapers()).filter((p) => p.status === 'published')

    const items: StudentPaper[] = []
    for (const summary of papers) {
      const attempts = (await deps.repo.listAttempts(summary.id)).filter(
        (a) => !a.preview && (student ? a.student === student : false),
      )
      const best = attempts.reduce<null | (typeof attempts)[number]>(
        (acc, a) => (acc === null || a.score > acc.score ? a : acc),
        null,
      )
      items.push({
        id: summary.id,
        title: summary.title,
        subject: summary.subject,
        grade: summary.grade,
        questionCount: summary.questionCount,
        totalScore: summary.totalScore,
        durationMin: summary.durationMin,
        myAttempts: attempts.length,
        myBest: best ? { score: best.score, maxScore: best.maxScore, attemptId: best.id } : null,
      })
    }
    return { items }
  })

  /** 我的全部作答记录，按时间倒序 */
  app.get<{ Querystring: { student?: string } }>('/api/student/attempts', async (request, reply) => {
    const student = currentUser(request)?.displayName ?? ''
    if (!student) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '请先登录' })

    const papers = await deps.repo.listPapers()
    const titles = new Map(papers.map((p) => [p.id, p.title]))
    const rows: Array<{
      id: string
      paperId: string
      paperTitle: string
      score: number
      maxScore: number
      submittedAt: string
      wrong: number
    }> = []

    for (const paper of papers) {
      for (const attempt of await deps.repo.listAttempts(paper.id)) {
        if (attempt.preview || attempt.student !== student) continue
        rows.push({
          id: attempt.id,
          paperId: attempt.paperId,
          paperTitle: titles.get(attempt.paperId) ?? '（已删除的试卷）',
          score: attempt.score,
          maxScore: attempt.maxScore,
          submittedAt: attempt.submittedAt,
          wrong: attempt.result.results.filter((r) => r.verdict !== 'correct').length,
        })
      }
    }

    rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    return { items: rows.slice(0, 50) }
  })

  /** 单次作答详情：错题回顾要题干、我的答案、正确答案、解析 */
  app.get<{ Params: { id: string } }>('/api/attempts/:id', async (request, reply) => {
    const attempt = await deps.repo.getAttempt(request.params.id)
    if (!attempt) return reply.code(404).send({ error: 'NOT_FOUND', message: '作答记录不存在' })

    // 只能看自己的答卷：换个 id 猜别人的记录也拿不到
    const me = currentUser(request)
    if (!me || attempt.student !== me.displayName) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只能查看自己的作答' })
    }

    const paper = await deps.repo.getPaper(attempt.paperId)
    const ir: PaperIR | null = paper?.ir ?? null
    const questions = ir ? ir.sections.flatMap((s) => s.questions) : []

    return {
      attempt: {
        id: attempt.id,
        student: attempt.student,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        maxScore: attempt.maxScore,
        result: attempt.result,
      },
      paper: ir ? { id: paper?.id, title: ir.title, subject: ir.subject, grade: ir.grade } : null,
      /** 只给错题，按原顺序 */
      review: attempt.result.results
        .map((r, index) => {
          const q = questions.find((item) => item.id === r.questionId)
          if (!q || r.verdict === 'correct') return null
          return {
            index: index + 1,
            question: {
              id: q.id,
              type: q.type,
              stem: q.stem,
              options: q.options ?? [],
              answers: q.answers,
              explanation: q.explanation ?? '',
              knowledgePoints: q.knowledgePoints,
            },
            awarded: r.awarded,
            max: r.max,
            verdict: r.verdict,
            /** 早期记录里没有这个字段，保持 undefined 让前端能区分"没记录"和"没作答" */
            myAnswer: r.answer,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    }
  })

  /** 学生端 AI：只讲解，不能改卷；只能看到已发布的试卷 */
  app.post('/api/student/assistant', async (request, reply) => {
    const parsed = assistantChatSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '对话内容不合法' })
    }
    if (!allowAssistant(request.ip)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', message: '提问太频繁，歇一下再问' })
    }
    if (isDemo()) {
      return reply.code(409).send({
        error: 'DEMO_MODE',
        message: '当前是演示模式：AI 讲解需要真实模型，请老师先在教师端配置。',
      })
    }

    // 只允许读已发布试卷；草稿对学生在任何路径上都不可见
    let paper: PaperIR | null = null
    const paperId = parsed.data.context.paperId
    if (paperId) {
      const record = await deps.repo.getPaper(paperId)
      if (record && record.status === 'published') paper = record.ir
    }

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, SSE_HEADERS)

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    const emit = (event: AssistantEvent): void => {
      if (!res.writableEnded) res.write(encodeAssistantSse(event))
    }

    try {
      await runStudentTutor({
        paper,
        history: parsed.data.messages,
        llm: deps.makeLlmPort(controller.signal),
        emit,
        signal: controller.signal,
      })
    } catch (error) {
      const code = error instanceof LlmError ? error.code : 'INTERNAL'
      emit({ type: 'error', code, message: error instanceof Error ? error.message : '助手出错了' })
    } finally {
      emit({ type: 'done' })
      res.end()
    }
  })
}
