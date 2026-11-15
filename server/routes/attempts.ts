import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PaperRepo } from '../infra/repo.js'
import { currentUser } from '../auth/session.js'

const attemptBodySchema = z.object({
  paperId: z.string().min(1).max(64),
  /**
   * 兼容旧客户端：字段可以不带，服务端一律以会话身份为准。
   * 之前把它写成必填，导致前端改成"身份来自登录态"后交卷整片 400。
   */
  student: z.string().max(40).optional(),
  answers: z.record(z.string(), z.array(z.string().max(2000)).max(8)).default({}),
})

/**
 * 交卷：教师端和学生端都要有。
 *
 * 放在独立文件里，是为了让"哪端能做什么"在 app.ts 一眼可读：
 * 交卷是两端共用的唯一写接口，其余全部按端隔离。
 */
export function registerAttemptRoutes(app: FastifyInstance, deps: { repo: PaperRepo }): void {
  app.post('/api/attempts', async (request, reply) => {
    const parsed = attemptBodySchema.safeParse(request.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: issue ? `作答数据不合法：${issue.path.join('.') || '格式'} ${issue.message}` : '作答数据不合法',
      })
    }
    const record = await deps.repo.getPaper(parsed.data.paperId)
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '试卷不存在' })

    // 草稿也允许试答：老师需要在发布前自己走一遍。
    // 这类提交标记为 preview——入库、可回看，但不计入学情统计。
    // 身份来自会话，不采信请求体里的 student——否则学生可以冒充任何人交卷
    const user = currentUser(request)
    if (!user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '请先登录' })
    const preview = record.status !== 'published'

    const { gradePaper } = await import('../domain/grader.js')
    const result = gradePaper(record.ir, parsed.data.answers)
    const attempt = await deps.repo.createAttempt({
      paperId: record.id,
      student: user.displayName,
      score: result.score,
      maxScore: result.maxScore,
      preview,
      result,
    })
    return { attemptId: attempt.id, score: result.score, maxScore: result.maxScore, preview, result }
  })
}
