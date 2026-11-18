import { useEffect, useState } from 'react'
import { api } from '../api.js'

interface MyAttempt {
  id: string
  paperId: string
  paperTitle: string
  score: number
  maxScore: number
  submittedAt: string
  wrong: number
}

/** 错题回顾列表：侧边栏那个入口之前是死链，现在是一个真的页面 */
export function ReviewsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<MyAttempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ items: MyAttempt[] }>('/api/student/attempts')
      .then((res) => setItems(res.items))
      .catch((err: Error) => {
        setError(err.message)
        setItems([])
      })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>错题回顾</h1>
        <p>每次交卷的错题都在这里，点进去逐题对照正确答案与解析。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {items === null ? (
        <div className="stage-empty">载入中…</div>
      ) : items.length === 0 ? (
        <div className="card panel muted">还没有交卷记录。去「试卷」做一套吧。</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((attempt) => {
            const percent = attempt.maxScore > 0 ? Math.round((attempt.score / attempt.maxScore) * 100) : 0
            return (
              <button
                key={attempt.id}
                className="card review-row"
                onClick={() => onNavigate(`/review/${attempt.id}`)}
              >
                <div className="review-row-main">
                  <strong>{attempt.paperTitle}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {new Date(attempt.submittedAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="review-row-stats">
                  <span className={`tag ${percent >= 60 ? 'ok' : 'warn'}`}>
                    {attempt.score} / {attempt.maxScore}
                    <span className="tag-sub">{attempt.wrong > 0 ? `· ${attempt.wrong} 道错题` : '· 全对'}</span>
                  </span>
                  <span className="review-row-go">查看 →</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
