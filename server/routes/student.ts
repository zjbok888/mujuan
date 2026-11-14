import type { FastifyInstance } from 'fastify'
import type { PaperRepo } from '../infra/repo.js'
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

function nameOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 32) : ''
}

export function registerStudentRoutes(app: FastifyInstance, deps: StudentDeps): void {
  /** 学生能看到的卷子：只有已发布的 */
  app.get<{ Querystring: { student?: string } }>('/api/student/papers', async (request) => {
    const student = nameOf(request.query.student)
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
    const student = nameOf(request.query.student)
    if (!student) return reply.code(400).send({ error: 'MISSING_STUDENT', message: '请先填写姓名' })

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
}
