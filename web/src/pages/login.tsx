import { useEffect, useState } from 'react'
import type { PublicUser } from '@shared/auth.js'
import { fetchDemoCredentials, login } from '../auth.js'

/**
 * 两个端口共用同一个登录页，但标题与提示按端区分。
 * 走错端时服务端会告诉他该去哪个端口——这比"登录失败"有用得多。
 */
export function LoginPage({
  role,
  onLoggedIn,
}: {
  role: 'teacher' | 'student'
  onLoggedIn: (user: PublicUser) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demo, setDemo] = useState<{ username: string; password: string } | null>(null)

  // 只有默认口令还没改过时才会有值；改过密码按钮就自动消失
  useEffect(() => {
    void fetchDemoCredentials().then(setDemo)
  }, [])

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

        {demo && (
          <button
            className="btn btn-sm btn-ghost login-fill"
            type="button"
            onClick={() => {
              setUsername(demo.username)
              setPassword(demo.password)
              setError(null)
            }}
          >
            一键填充测试账号
          </button>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? '登录中…' : role === 'teacher' ? '进入教师端' : '进入学生端'}
        </button>
      </form>
    </div>
  )
}
