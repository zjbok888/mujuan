import type { FastifyInstance } from 'fastify'
import { computeStats } from '../domain/stats.js'
import type { RouteDeps } from './papers.js'

export function registerStatsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Params: { id: string } }>('/api/papers/:id/stats', async (request, reply) => {
    const record = await deps.repo.getPaper(request.params.id)
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })
    const allAttempts = await deps.repo.listAttempts(record.id)
    // 发布前的试答（preview）不计入学情，否则教师自测会污染班级数据
    const attempts = allAttempts.filter((a) => !a.preview)
    return {
      paperId: record.id,
      title: record.ir.title,
      stats: computeStats(
        record.ir,
        attempts.map((a) => ({ student: a.student, score: a.score, maxScore: a.maxScore, result: a.result })),
      ),
      students: attempts.map((a) => ({
        student: a.student,
        score: a.score,
        submittedAt: a.submittedAt,
      })),
    }
  })
}
