import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AssistantContext } from '@shared/assistant.js'
import { api } from './api.js'
import { Assistant } from './components/assistant.js'
import { generation, generationProgress } from './generation.js'
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
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [health, setHealth] = useState<Health | null>(null)
  const run = useSyncExternalStore(generation.subscribe, generation.getSnapshot)
  const { filled, total } = generationProgress(run)

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

  const go = useCallback((path: string) => navigate(path), [])

  // 助手需要知道自己"站在哪一页、看的是哪份卷子"
  const assistantContext: AssistantContext =
    route.name === 'paper' || route.name === 'take' || route.name === 'stats'
      ? { page: route.name, paperId: route.id }
      : route.name === 'student' || route.name === 'review'
        ? { page: route.name }
        : { page: route.name }

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
          <a href="#/" className={route.name === 'compose' ? 'active' : ''}>
            <i className="dot" />出卷
          </a>
          <a href="#/library" className={route.name === 'library' ? 'active' : ''}>
            <i className="dot" />卷库
          </a>
          <a href="#/student" className={route.name === 'student' ? 'active' : ''}>
            <i className="dot" />学生端
          </a>
          <a href="#/settings" className={route.name === 'settings' ? 'active' : ''}>
            <i className="dot" />接入
          </a>
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
          <div>意图 → 中间表示 → 确定性渲染</div>
        </div>
      </aside>

      <main className="main">
        {route.name === 'compose' && <ComposePage onNavigate={go} />}
        {route.name === 'library' && <LibraryPage onNavigate={go} />}
        {route.name === 'student' && <StudentPage onNavigate={go} />}
        {route.name === 'review' && <ReviewPage id={route.id} onNavigate={go} />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'paper' && <PaperPage id={route.id} onNavigate={go} />}
        {route.name === 'take' && <TakePage id={route.id} onNavigate={go} />}
        {route.name === 'stats' && <StatsPage id={route.id} onNavigate={go} />}
      </main>

      <Assistant context={assistantContext} />
    </div>
  )
}
