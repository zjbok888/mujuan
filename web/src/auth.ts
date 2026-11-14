import type { PublicUser } from '@shared/auth.js'

/** 登录态相关的三个调用；错误信息直接来自服务端，便于把"走错端"讲清楚 */
export async function fetchMe(): Promise<PublicUser | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`读取登录状态失败（${res.status}）`)
  const data = (await res.json()) as { user: PublicUser }
  return data.user
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = (await res.json().catch(() => null)) as { user?: PublicUser; message?: string } | null
  if (!res.ok) throw new Error(data?.message ?? '登录失败')
  if (!data?.user) throw new Error('登录失败')
  return data.user
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}
