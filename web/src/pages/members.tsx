import { useEffect, useState } from 'react'
import type { PublicUser } from '@shared/auth.js'
import { api } from '../api.js'

/** 班级成员：老师建账号、改密码、删人。学生自助注册被刻意排除在外。 */
export function MembersPage() {
  const [items, setItems] = useState<PublicUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', displayName: '', password: '' })
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    api
      .get<{ items: PublicUser[] }>('/api/users')
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
  }

  useEffect(load, [])

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.post('/api/users', { ...form, role: 'student' })
      setNotice(`已创建 ${form.displayName || form.username}`)
      setForm({ username: '', displayName: '', password: '' })
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const resetPassword = async (user: PublicUser): Promise<void> => {
    const next = window.prompt(`给「${user.displayName}」设置新密码（至少 6 位）`)
    if (!next) return
    try {
      await api.post(`/api/users/${user.id}/password`, { password: next })
      setNotice(`已重置 ${user.displayName} 的密码`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = async (user: PublicUser): Promise<void> => {
    if (!window.confirm(`删除账号「${user.displayName}」？\n他之后的成绩仍会保留，但无法再登录。`)) return
    try {
      await api.del(`/api/users/${user.id}`)
      setNotice(`已删除 ${user.displayName}`)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>班级成员</h1>
        <p>学生账号由你创建并分配初始密码。墨卷不开放自助注册——一间教室里谁能进，应该由老师决定。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}
      {notice && <div className="statusbar ok">{notice}</div>}

      <section className="card panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>新增学生</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <label className="field">
            <span className="label">登录账号</span>
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="如 xiaoman 或 张三"
            />
          </label>
          <label className="field">
            <span className="label">显示姓名</span>
            <input
              className="input"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="成绩单上显示的名字"
            />
          </label>
          <label className="field">
            <span className="label">初始密码</span>
            <input
              className="input"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="至少 6 位"
            />
          </label>
        </div>
        <div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void add()}
            disabled={busy || !form.username || !form.displayName || form.password.length < 6}
          >
            {busy ? '创建中…' : '创建账号'}
          </button>
        </div>
      </section>

      <section className="card panel">
        <h2 style={{ marginTop: 0 }}>成员列表</h2>
        {items === null ? (
          <p className="muted">载入中…</p>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>姓名</th>
                <th>账号</th>
                <th style={{ width: 90 }}>角色</th>
                <th style={{ width: 120 }}>创建时间</th>
                <th style={{ width: 160 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {user.username}
                  </td>
                  <td>
                    <span className={user.role === 'teacher' ? 'tag seal' : 'tag'}>
                      {user.role === 'teacher' ? '老师' : '学生'}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => void resetPassword(user)}>
                      改密码
                    </button>
                    {user.role !== 'teacher' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => void remove(user)}>
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
