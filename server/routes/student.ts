import type { FastifyInstance } from 'fastify'
import { assistantChatSchema, encodeAssistantSse, type AssistantEvent } from '../../shared/assistant.js'
import { SSE_HEADERS } from '../../shared/events.js'
import { runStudentTutor } from '../domain/assistant.js'
import type { LlmPort } from '../domain/generator.js'
import { LlmError, extractJson } from '../infra/llm.js'
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

  /**
   * 单份试卷。
   * 答卷页用的是 `/api/papers/:id`，但那条路由只在教师端注册；
   * 学生端补一条同名路由，且**只放行已发布**——草稿对学生必须像不存在一样。
   */
  app.get<{ Params: { id: string } }>('/api/papers/:id', async (request, reply) => {
    const record = await deps.repo.getPaper(request.params.id)
    if (!record || record.status !== 'published') {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在或尚未发布' })
    }
    return { id: record.id, status: record.status, paper: record.ir }
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

const DIAGNOSIS_SYSTEM = `你是学习诊断老师。根据学生的错题记录，给出具体、可执行的学习建议。
只输出 JSON：{"overview":"一句话总评（30字内）","weaknesses":[{"point":"知识点","reason":"为什么弱（20字内）"}],"actions":["具体做法（30字内）"]}
硬性要求：
1. weaknesses 最多 3 条，必须来自给定知识点，不得编造；
2. actions 恰好 3 条，要能今天就做（例如"重做第 3、7 题并写出每一步理由"），
   禁止"多练习""认真听讲"这类空话；
3. 中文，不要 markdown，不要道歉，不要重复题干。`

/** 学习诊断：把学生的错题汇总成一份可执行建议 */
export function registerDiagnosisRoute(app: FastifyInstance, deps: StudentDeps): void {
  const allow = createRateLimiter(6, 60_000)

  app.post('/api/student/diagnosis', async (request, reply) => {
    const me = currentUser(request)
    if (!me) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '请先登录' })
    if (!allow(request.ip)) return reply.code(429).send({ error: 'RATE_LIMITED', message: '诊断太频繁，稍后再试' })
    if (isDemo()) {
      return reply.code(409).send({ error: 'DEMO_MODE', message: '演示模式下没有可用的模型，诊断需要真实接入' })
    }

    const papers = await deps.repo.listPapers()
    const wrong: string[] = []
    let attempts = 0
    let ratioSum = 0

    for (const summary of papers) {
      const record = await deps.repo.getPaper(summary.id)
      if (!record) continue
      const questions = record.ir.sections.flatMap((s) => s.questions)
      for (const attempt of await deps.repo.listAttempts(summary.id)) {
        if (attempt.preview || attempt.student !== me.displayName) continue
        attempts += 1
        ratioSum += attempt.maxScore > 0 ? attempt.score / attempt.maxScore : 0
        attempt.result.results.forEach((r, index) => {
          if (r.verdict === 'correct') return
          const q = questions.find((item) => item.id === r.questionId)
          if (!q) return
          wrong.push(
            `- 第 ${index + 1} 题（${q.type}，知识点：${q.knowledgePoints.join('、') || '未标注'}）` +
              `学生答：${(r.answer ?? []).join(' / ') || '空'}；正确答案：${q.answers.join(' / ')}`,
          )
        })
      }
    }

    if (attempts === 0) return { diagnosis: null, message: '还没有提交记录，先做一套卷子吧' }
    if (wrong.length === 0) {
      return {
        diagnosis: { overview: '全部答对了，暂时没有薄弱点', weaknesses: [], actions: ['换一份更难的卷子继续练'] },
        message: '',
      }
    }

    const avg = Math.round((ratioSum / attempts) * 100)
    const context = [
      `学生：${me.displayName}`,
      `已完成 ${attempts} 次作答，平均得分率 ${avg}%`,
      `错题清单（最多 30 条）：`,
      ...wrong.slice(0, 30),
    ].join('\n')

    try {
      const raw = await deps.makeLlmPort(new AbortController().signal)(
        [
          { role: 'system', content: DIAGNOSIS_SYSTEM },
          { role: 'user', content: context },
        ],
        { json: true, maxTokens: 3000 },
      )
      const parsed = extractJson(raw) as {
        overview?: string
        weaknesses?: Array<{ point?: string; reason?: string }>
        actions?: string[]
      }
      return {
        diagnosis: {
          overview: parsed.overview ?? '',
          weaknesses: (parsed.weaknesses ?? []).slice(0, 3).map((w) => ({
            point: w.point ?? '',
            reason: w.reason ?? '',
          })),
          actions: (parsed.actions ?? []).slice(0, 3),
        },
        message: '',
      }
    } catch (error) {
      return reply.code(502).send({
        error: 'DIAGNOSIS_FAILED',
        message: error instanceof LlmError ? error.message : '诊断生成失败，请稍后再试',
      })
    }
  })
}
