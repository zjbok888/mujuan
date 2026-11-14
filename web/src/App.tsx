import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AssistantContext } from '@shared/assistant.js'
import { api } from './api.js'
import { Assistant } from './components/assistant.js'
import { generation, generationProgress } from './generation.js'
import type { PublicUser } from '@shared/auth.js'
import { fetchMe, logout } from './auth.js'
import { LoginPage } from './pages/login.js'
import { MembersPage } from './pages/members.js'
import { ComposePage } from './pages/compose.js'
import { LibraryPage } from './pages/library.js'
import { PaperPage } from './pages/paper.js'
import { ReviewPage } from './pages/review.js'
import { SettingsPage } from './pages/settings.js'
import { StatsPage } from './pages/stats.js'
import { StudentPage } from './pages/student.js'
import { TakePage } from './pages/take.js'

export type Route =
  | { name: 'compose' }
  | { name: 'library' }
  | { name: 'student' }
  | { name: 'settings' }
  | { name: 'members' }
  | { name: 'paper'; id: string }
  | { name: 'take'; id: string }
  | { name: 'stats'; id: string }
  | { name: 'review'; id: string }

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [head, id] = parts
  if (head === 'library') return { name: 'library' }
  if (head === 'student') return { name: 'student' }
  if (head === 'settings') return { name: 'settings' }
  if (head === 'members') return { name: 'members' }
  if (head === 'paper' && id) return { name: 'paper', id }
  if (head === 'take' && id) return { name: 'take', id }
  if (head === 'stats' && id) return { name: 'stats', id }
  if (head === 'review' && id) return { name: 'review', id }
  return { name: 'compose' }
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`
}

export interface Health {
  ok: boolean
  mode: 'demo' | 'live'
  driver: string
  model: string
  version: string
  /** 另一端的端口，用于登录页引导 */
  peerPort?: number
  /** 仅教师端返回：学生端端口 */
  studentPort?: number
}

/** 服务端按端口注入：同一个构建，教师端 / 学生端渲染不同的页面集 */
const ROLE_ID: 'teacher' | 'student' =
  (window as unknown as { __MJUAN_ROLE__?: string }).__MJUAN_ROLE__ === 'student' ? 'student' : 'teacher'

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [health, setHealth] = useState<Health | null>(null)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const run = useSyncExternalStore(generation.subscribe, generation.getSnapshot)
  const { filled, total } = generationProgress(run)

  // 没有会话就先过登录页；服务端仍然逐个接口校验，前端这层只是体验
  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const loadHealth = (): void => {
      api
        .get<Health>('/api/health')
        .then(setHealth)
        .catch(() => setHealth(null))
    }
    loadHealth()
    // 接入配置改了之后，顶部的模式角标要立刻跟着变
    const onChange = (): void => loadHealth()
    window.addEventListener('mujuan:settings-changed', onChange)
    return () => window.removeEventListener('mujuan:settings-changed', onChange)
  }, [])

  // 所有 hook 必须在任何提前 return 之前——否则登录前后挂载的 hook 数量不同，
  // React 会直接抛 #310（Rendered more hooks than during the previous render）。
  const go = useCallback((path: string) => navigate(path), [])

  if (!authChecked) return <div className="stage-empty" style={{ paddingTop: 120 }}>载入中…</div>
  if (!user) {
    return <LoginPage role={ROLE_ID} peerPort={health?.peerPort} onLoggedIn={setUser} />
  }

  // 同一个构建产物，两端各自注入角色：教师端渲染出卷/卷库/接入，学生端只渲染试卷与错题
  const ROLE: 'teacher' | 'student' = ROLE_ID
  const allowed: Route['name'][] =
    ROLE === 'teacher'
      ? ['compose', 'library', 'paper', 'take', 'stats', 'settings', 'members']
      : ['student', 'take', 'review']
  // 直接敲别的端的地址也不该串台，回落本端首页
  const view: Route = allowed.includes(route.name)
    ? route
    : { name: ROLE === 'teacher' ? 'compose' : 'student' }

  // 助手需要知道自己"站在哪一页、看的是哪份卷子"
  const assistantContext: AssistantContext =
    view.name === 'paper' || view.name === 'take' || view.name === 'stats'
      ? { page: view.name, paperId: view.id }
      : view.name === 'student' || view.name === 'review'
        ? { page: view.name }
        : { page: view.name }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="seal">卷</div>
          <div className="brand-text">
            <strong>墨卷</strong>
            <span>MoJuan</span>
          </div>
        </div>

        <nav className="nav">
          {ROLE === 'teacher' ? (
            <>
              <a href="#/" className={view.name === 'compose' ? 'active' : ''}>
                <i className="dot" />出卷
              </a>
              <a href="#/library" className={view.name === 'library' ? 'active' : ''}>
                <i className="dot" />卷库
              </a>
              <a href="#/settings" className={view.name === 'settings' ? 'active' : ''}>
                <i className="dot" />接入
              </a>
              <a href="#/members" className={view.name === 'members' ? 'active' : ''}>
                <i className="dot" />成员
              </a>
            </>
          ) : (
            <>
              <a href="#/student" className={view.name === 'student' ? 'active' : ''}>
                <i className="dot" />试卷
              </a>
              <a href="#/student" className={view.name === 'review' ? 'active' : ''}>
                <i className="dot" />错题回顾
              </a>
            </>
          )}
        </nav>

        <div className="rail-foot">
          {run.phase === 'running' && (
            <div style={{ marginBottom: 10 }}>
              <a href="#/" className="tag seal" title="生成在后台继续">
                出卷中 {filled}/{total}
              </a>
            </div>
          )}
          <div className="badge">
            {health ? (
              health.mode === 'demo' ? (
                <span className="tag warn">演示模式 · 回放</span>
              ) : (
                <span className="tag ok">在线模式 · {health.model}</span>
              )
            ) : (
              <span className="tag">连接中…</span>
            )}
          </div>
          <div>{health ? `存储 ${health.driver} · v${health.version}` : '—'}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="tag">{user.role === 'teacher' ? '老师' : '学生'} · {user.displayName}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                void logout().finally(() => setUser(null))
              }}
            >
              退出
            </button>
          </div>
          {ROLE === 'teacher' && health?.studentPort && (
            <div style={{ marginTop: 8 }}>
              <a
                className="rail-student-link"
                href={`http://${window.location.hostname}:${health.studentPort}/`}
                target="_blank"
                rel="noreferrer"
                title={`学生端在 ${health.studentPort} 端口，学生用老师分配的账号登录`}
              >
                学生端入口 ↗
              </a>
            </div>
          )}
          <div>意图 → 中间表示 → 确定性渲染</div>
        </div>
      </aside>

      <main className="main">
        {view.name === 'compose' && <ComposePage onNavigate={go} />}
        {view.name === 'library' && <LibraryPage onNavigate={go} />}
        {view.name === 'student' && <StudentPage onNavigate={go} />}
        {view.name === 'review' && <ReviewPage id={view.id} onNavigate={go} />}
        {view.name === 'settings' && <SettingsPage />}
        {view.name === 'members' && <MembersPage />}
        {view.name === 'paper' && <PaperPage id={view.id} onNavigate={go} />}
        {view.name === 'take' && <TakePage id={view.id} onNavigate={go} />}
        {view.name === 'stats' && <StatsPage id={view.id} onNavigate={go} />}
      </main>

      <Assistant context={assistantContext} role={ROLE} />
    </div>
  )
}
