import { useEffect, useState } from 'react'
import { api } from '../api.js'

interface Diagnosis {
  overview: string
  weaknesses: Array<{ point: string; reason: string }>
  actions: string[]
}

interface StudentPaper {
  id: string
  title: string
  subject: string
  grade: string
  questionCount: number
  totalScore: number
  durationMin: number
  myAttempts: number
  myBest: { score: number; maxScore: number; attemptId: string } | null
}

interface MyAttempt {
  id: string
  paperId: string
  paperTitle: string
  score: number
  maxScore: number
  submittedAt: string
  wrong: number
}


function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function StudentPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [papers, setPapers] = useState<StudentPaper[] | null>(null)
  const [attempts, setAttempts] = useState<MyAttempt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)

  const runDiagnosis = async (): Promise<void> => {
    setDiagBusy(true)
    setDiagError(null)
    try {
      const res = await api.post<{ diagnosis: Diagnosis | null; message: string }>('/api/student/diagnosis', {})
      if (res.diagnosis) setDiagnosis(res.diagnosis)
      else setDiagError(res.message || '暂时无法生成诊断')
    } catch (err) {
      setDiagError((err as Error).message)
    } finally {
      setDiagBusy(false)
    }
  }

  // 身份由登录态决定，不再让学生自己填名字——填名字等于可以冒充别人
  useEffect(() => {
    let alive = true
    Promise.all([
      api.get<{ items: StudentPaper[] }>('/api/student/papers'),
      api.get<{ items: MyAttempt[] }>('/api/student/attempts'),
    ])
      .then(([paperRes, attemptRes]) => {
        if (!alive) return
        setPapers(paperRes.items)
        setAttempts(attemptRes.items)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>学生端</h1>
        <p>这里只有老师已经发布的卷子。你的成绩与错题都记在当前账号下。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      <section>
        <h2 style={{ marginBottom: 10 }}>可作答的试卷</h2>
        {papers === null ? (
          <div className="stage-empty">载入中…</div>
        ) : papers.length === 0 ? (
          <div className="card panel muted">老师还没有发布试卷。等发布后再来看看。</div>
        ) : (
          <div className="grid-2" style={{ gap: 12 }}>
            {papers.map((paper) => (
              <article className="card lib-card" key={paper.id} style={{ cursor: 'default' }}>
                <div className="lib-head">
                  <span className="tag ok">已发布</span>
                  <span className="tag">{paper.questionCount} 题</span>
                  <span className="tag">{paper.totalScore} 分</span>
                  {paper.myBest && (
                    <span className="tag seal">
                      我的最高 {paper.myBest.score}/{paper.myBest.maxScore}
                    </span>
                  )}
                </div>
                <h3 className="lib-title">{paper.title}</h3>
                <div className="lib-meta">
                  <span>
                    {paper.subject} · {paper.grade} · {paper.durationMin} 分钟
                  </span>
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => onNavigate(`/take/${paper.id}`)}>
                    {paper.myAttempts > 0 ? '再做一次' : '开始作答'}
                  </button>
                  {paper.myBest && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => onNavigate(`/review/${paper.myBest?.attemptId}`)}
                    >
                      看错题
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {attempts && (
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>我的成绩</h2>
            {attempts.length > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => void runDiagnosis()}
                disabled={diagBusy}
                title="让 AI 根据你的错题给建议"
              >
                {diagBusy ? '分析中…' : 'AI 学习诊断'}
              </button>
            )}
          </div>

          {diagError && <div className="statusbar err">{diagError}</div>}

          {diagnosis && (
            <div className="card panel" style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <span className="tag seal">学习诊断</span>
                <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 600, lineHeight: 1.7 }}>
                  {diagnosis.overview}
                </p>
              </div>

              {diagnosis.weaknesses.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span className="label">薄弱点</span>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
                    {diagnosis.weaknesses.map((item, index) => (
                      <li key={index}>
                        <strong>{item.point}</strong>
                        <span className="muted"> — {item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <span className="label">接下来这样做</span>
                <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
                  {diagnosis.actions.map((action, index) => (
                    <li key={index}>{action}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {attempts.length === 0 ? (
            <div className="card panel muted">还没有交卷记录。做完上面的卷子就会出现在这里。</div>
          ) : (
            <div className="card panel">
              <table className="plain">
                <thead>
                  <tr>
                    <th>试卷</th>
                    <th style={{ width: 110 }}>得分</th>
                    <th style={{ width: 80 }}>错题</th>
                    <th style={{ width: 110 }}>时间</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>{attempt.paperTitle}</td>
                      <td>
                        <strong>{attempt.score}</strong>
                        <span className="muted"> / {attempt.maxScore}</span>
                      </td>
                      <td>{attempt.wrong}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {formatTime(attempt.submittedAt)}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => onNavigate(`/review/${attempt.id}`)}
                        >
                          错题回顾
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
