import type { FastifyInstance } from 'fastify'
import { createUserSchema, loginSchema, resetPasswordSchema, type Role } from '../../shared/auth.js'
import { createRateLimiter } from '../infra/rate-limit.js'
import { createSession, currentUser, destroySession } from '../auth/session.js'
import {
  createUser,
  deleteUser,
  listUsers,
  resetPassword,
  toPublic,
  verifyLogin,
} from '../auth/users.js'

/**
 * 登录接口在两个端口上都有，但**只接受本端角色**。
 * 账号错了端会明确告诉你去哪个地址，而不是笼统地"登录失败"。
 */
export function registerAuthRoutes(app: FastifyInstance, deps: { role: Role; peerPort: number }): void {
  const allowLogin = createRateLimiter(10, 60_000)

  app.post('/api/auth/login', async (request, reply) => {
    if (!allowLogin(request.ip)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' })
    }
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '请输入账号和密码' })
    }

    const user = verifyLogin(parsed.data.username, parsed.data.password)
    if (!user) {
      // 不区分"账号不存在"和"密码错误"，避免被枚举
      return reply.code(401).send({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' })
    }

    if (user.role !== deps.role) {
      const label = deps.role === 'teacher' ? '教师端' : '学生端'
      const other = user.role === 'teacher' ? '教师端' : '学生端'
      return reply.code(403).send({
        error: 'WRONG_PORT',
        message: `这是${label}，${user.displayName} 是${other}账号。请到 ${other}（端口 ${deps.peerPort}）登录。`,
      })
    }

    createSession(reply, user)
    return { user }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    destroySession(request, reply)
    return { ok: true }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const user = currentUser(request)
    if (!user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '未登录' })
    return { user, expectedRole: deps.role }
  })

  /**
   * 登录页的"快速填充"数据源。
   * 只在**默认口令还没被改过**时才返回——它自带失效条件：
   * 老师一旦改了密码，前端按钮自动消失，不会留下一个永远能拿到口令的后门。
   */
  app.get('/api/auth/demo-credentials', async () => {
    const candidates =
      deps.role === 'teacher'
        ? [{ username: (process.env.TEACHER_USER ?? 'teacher').trim(), password: 'mujuan2026' }]
        : [{ username: 'xiaoman', password: '123456' }]

    for (const candidate of candidates) {
      if (verifyLogin(candidate.username, candidate.password)) {
        return { credentials: candidate }
      }
    }
    return { credentials: null }
  })

  // ── 以下仅教师可用：班级成员管理 ────────────────────────────────
  app.get('/api/users', async (request, reply) => {
    const user = currentUser(request)
    if (!user || user.role !== 'teacher') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只有老师可以查看成员' })
    }
    return { items: listUsers() }
  })

  app.post('/api/users', async (request, reply) => {
    const user = currentUser(request)
    if (!user || user.role !== 'teacher') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只有老师可以添加成员' })
    }
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: first?.message ?? '参数不合法' })
    }
    try {
      const created = createUser(parsed.data)
      return { user: toPublic(created as never) }
    } catch (error) {
      return reply.code(409).send({ error: 'DUPLICATE', message: (error as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (request, reply) => {
    const user = currentUser(request)
    if (!user || user.role !== 'teacher') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只有老师可以重置密码' })
    }
    const parsed = resetPasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '密码至少 6 位' })
    }
    if (!resetPassword(request.params.id, parsed.data.password)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '账号不存在' })
    }
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (request, reply) => {
    const user = currentUser(request)
    if (!user || user.role !== 'teacher') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只有老师可以删除成员' })
    }
    if (user.id === request.params.id) {
      return reply.code(400).send({ error: 'SELF_DELETE', message: '不能删除当前登录的账号' })
    }
    if (!deleteUser(request.params.id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '账号不存在' })
    }
    return { ok: true }
  })
}
