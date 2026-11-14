import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { RichText } from '../components/rich-text.js'

interface PaperStats {
  submissions: number
  avgPercent: number
  fullScore: number
  passRate: number
  distribution: Array<{ label: string; count: number }>
  knowledge: Array<{ knowledgePoint: string; asked: number; awarded: number; max: number; accuracy: number }>
  hardest: Array<{ questionId: string; stem: string; accuracy: number; asked: number }>
}

interface StatsResponse {
  paperId: string
  title: string
  stats: PaperStats
  students: Array<{ student: string; score: number; submittedAt: string }>
}

function accuracyClass(value: number): string {
  if (value >= 75) return ''
  if (value >= 45) return 'mid'
  return 'low'
}

export function StatsPage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<StatsResponse>(`/api/papers/${id}/stats`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (error) return <div className="card panel">{error}</div>
  if (!data) return <div className="stage-empty">载入中…</div>

  const { stats } = data
  const maxBucket = Math.max(1, ...stats.distribution.map((d) => d.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="paper-head">
        <div>
          <h1 className="paper-title">学情 · {data.title}</h1>
          <div className="paper-meta">
            <span>{stats.submissions} 份提交</span>
            <span>满分 {stats.fullScore}</span>
            <span className="muted">数据由确定性评分实时聚合</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-sm" onClick={() => onNavigate(`/paper/${id}`)}>
            回到试卷
          </button>
          <a className="btn btn-sm" href={`/api/papers/${id}/attempts.csv`} download>
            导出成绩 CSV
          </a>
          <button className="btn btn-sm" onClick={() => onNavigate(`/take/${id}`)}>
            再试答一份
          </button>
        </div>
      </header>

      <div className="kpi">
        <div className="card cell">
          <div className="v">{stats.submissions}</div>
          <div className="l">提交份数</div>
        </div>
        <div className="card cell">
          <div className="v">{stats.avgPercent}%</div>
          <div className="l">平均得分率</div>
        </div>
        <div className="card cell">
          <div className="v">{stats.passRate}%</div>
          <div className="l">及格率（≥60%）</div>
        </div>
        <div className="card cell">
          <div className="v">{stats.knowledge.length}</div>
          <div className="l">覆盖知识点</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card panel">
          <h2>分数分布</h2>
          <div className="bars">
            {stats.distribution.map((bucket) => (
              <div className="bar" key={bucket.label}>
                <i style={{ height: `${(bucket.count / maxBucket) * 100}%` }} />
                <span>{bucket.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card panel">
          <h2>最需要补的知识点</h2>
          {stats.knowledge.length === 0 ? (
            <p className="muted">还没有作答数据。</p>
          ) : (
            <table className="plain">
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>正确率</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>得分/满分</th>
                </tr>
              </thead>
              <tbody>
                {stats.knowledge.slice(0, 6).map((row) => (
                  <tr key={row.knowledgePoint}>
                    <td>{row.knowledgePoint}</td>
                    <td className="nowrap">
                      <span className={`acc ${accuracyClass(row.accuracy)}`}>
                        <i style={{ width: `${Math.min(100, row.accuracy)}%` }} />
                      </span>
                      {row.accuracy}%
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {row.awarded}/{row.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card panel">
        <h2>失分最多的题</h2>
        {stats.hardest.length === 0 ? (
          <p className="muted">还没有作答数据。</p>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>题干</th>
                <th>被作答</th>
                <th style={{ textAlign: 'right' }}>正确率</th>
              </tr>
            </thead>
            <tbody>
              {stats.hardest.map((row) => (
                <tr key={row.questionId}>
                  <td style={{ maxWidth: 460 }}>
                    <RichText className="clamp2" text={row.stem} />
                  </td>
                  <td className="nowrap">{row.asked} 次</td>
                  <td style={{ textAlign: 'right' }} className="mono nowrap">
                    {row.accuracy}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card panel">
        <h2>提交记录</h2>
        {data.students.length === 0 ? (
          <p className="muted">还没有人交卷。</p>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>学生</th>
                <th>得分</th>
                <th style={{ textAlign: 'right' }}>交卷时间</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((row, index) => (
                <tr key={`${row.student}-${index}`}>
                  <td>{row.student}</td>
                  <td className="mono">{row.score}</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {new Date(row.submittedAt).toLocaleString('zh-CN')}
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
