import { randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PublicUser } from '../../shared/auth.js'
import { findByUsername } from './users.js'

/**
 * 会话：内存 + httpOnly Cookie。
 *
 * 不落盘是刻意的——进程重启后重新登录，比把会话密钥写进数据目录更安全。
 * Cookie 不区分端口，所以两个端共享一个会话；每个端再按角色各自把关。
 */
const COOKIE = 'mj_sid'
const TTL_MS = 12 * 60 * 60 * 1000

interface Session {
  user: PublicUser
  expiresAt: number
}

const sessions = new Map<string, Session>()

function readCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function createSession(reply: FastifyReply, user: PublicUser): string {
  const token = randomBytes(24).toString('hex')
  sessions.set(token, { user, expiresAt: Date.now() + TTL_MS })
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
  )
  return token
}

export function destroySession(request: FastifyRequest, reply: FastifyReply): void {
  const token = readCookie(request, COOKIE)
  if (token) sessions.delete(token)
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function currentUser(request: FastifyRequest): PublicUser | null {
  const token = readCookie(request, COOKIE)
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  // 账号可能被删除或改名，每次都以存储里的最新状态为准
  const fresh = findByUsername(session.user.username)
  if (!fresh) {
    sessions.delete(token)
    return null
  }
  session.user = fresh
  return fresh
}

/** 定期清理过期会话，避免长期运行内存里堆垃圾 */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token)
  }
}, 10 * 60 * 1000)
sweeper.unref?.()
