import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { ComposePage } from './pages/compose.js'
import { LibraryPage } from './pages/library.js'
import { PaperPage } from './pages/paper.js'
import { StatsPage } from './pages/stats.js'
import { TakePage } from './pages/take.js'

export type Route =
  | { name: 'compose' }
  | { name: 'library' }
  | { name: 'paper'; id: string }
  | { name: 'take'; id: string }
  | { name: 'stats'; id: string }

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [head, id] = parts
  if (head === 'library') return { name: 'library' }
  if (head === 'paper' && id) return { name: 'paper', id }
  if (head === 'take' && id) return { name: 'take', id }
  if (head === 'stats' && id) return { name: 'stats', id }
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

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    api.get<Health>('/api/health').then(setHealth).catch(() => setHealth(null))
  }, [])

  const go = useCallback((path: string) => navigate(path), [])

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
        </nav>

        <div className="rail-foot">
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
        {route.name === 'paper' && <PaperPage id={route.id} onNavigate={go} />}
        {route.name === 'take' && <TakePage id={route.id} onNavigate={go} />}
        {route.name === 'stats' && <StatsPage id={route.id} onNavigate={go} />}
      </main>
    </div>
  )
}
