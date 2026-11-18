import { useEffect, useState } from 'react'
import { api } from '../api.js'

interface RankItem {
  paperId: string
  paperTitle: string
  participants: number
  avg: number
  top: Array<{ name: string; score: number }>
  myBest: number | null
  myRank: number | null
}

/** 排行榜：每人每卷只取最好成绩，避免靠多刷次数刷名次 */
export function RankPage() {
  const [items, setItems] = useState<RankItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ items: RankItem[] }>('/api/student/rank')
      .then((res) => setItems(res.items))
      .catch((err: Error) => {
        setError(err.message)
        setItems([])
      })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>排行榜</h1>
        <p>每份卷子取各人的最好成绩对比。多刷几次不会让名次变高，只会让最好成绩变高。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {items === null ? (
        <div className="stage-empty">载入中…</div>
      ) : items.length === 0 ? (
        <div className="card panel muted">老师还没有公开排行榜。公开之后，这里会显示每份卷的名次。</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <article className="card panel" key={item.paperId}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{item.paperTitle}</strong>
                <span className="tag">{item.participants} 人参与</span>
                <span className="tag">平均 {item.avg} 分</span>
                {item.myRank !== null && <span className="tag seal">我的名次 第 {item.myRank} 名 · {item.myBest} 分</span>}
              </div>

              <ol className="rank-list">
                {item.top.map((row, index) => (
                  <li key={row.name} className={row.name === item.top[0]?.name && index === 0 ? 'first' : ''}>
                    <span className="rank-no">{index + 1}</span>
                    <span className="rank-name">{row.name}</span>
                    <span className="rank-score">{row.score}</span>
                  </li>
                ))}
              </ol>
              {item.participants > item.top.length && (
                <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  仅显示前 {item.top.length} 名
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
