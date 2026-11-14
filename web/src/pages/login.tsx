import { useState } from 'react'
import type { PublicUser } from '@shared/auth.js'
import { login } from '../auth.js'

/**
 * 两个端口共用同一个登录页，但标题与提示按端区分。
 * 走错端时服务端会告诉他该去哪个端口——这比"登录失败"有用得多。
 */
export function LoginPage({
  role,
  peerPort,
  onLoggedIn,
}: {
  role: 'teacher' | 'student'
  peerPort?: number
  onLoggedIn: (user: PublicUser) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const user = await login(username, password)
      onLoggedIn(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const other = role === 'teacher' ? '学生端' : '教师端'

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <div className="login-brand">
          <div className="seal">卷</div>
          <div>
            <strong>墨卷</strong>
            <span>{role === 'teacher' ? '教师端' : '学生端'}</span>
          </div>
        </div>

        <label className="field">
          <span className="label">账号</span>
          <input
            className="input"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={role === 'teacher' ? '老师账号' : '学号或姓名'}
          />
        </label>

        <label className="field">
          <span className="label">密码</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="初始密码由老师分配"
          />
        </label>

        {error && <div className="statusbar err" style={{ marginTop: 4 }}>{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? '登录中…' : role === 'teacher' ? '进入教师端' : '进入学生端'}
        </button>

        <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.7 }}>
          学生账号由老师创建，不支持自助注册。
          {peerPort ? (
            <>
              {' '}
              如果你是{other}，请访问{' '}
              <a href={`http://${window.location.hostname}:${peerPort}/`}>
                {window.location.hostname}:{peerPort}
              </a>
              。
            </>
          ) : null}
        </p>
      </form>
    </div>
  )
}
