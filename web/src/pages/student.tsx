import { useEffect, useState } from 'react'
import { api } from '../api.js'

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

const NAME_KEY = 'mujuan:student'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function StudentPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [papers, setPapers] = useState<StudentPaper[] | null>(null)
  const [attempts, setAttempts] = useState<MyAttempt[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim())
  }, [name])

  // 输入名字时不要每敲一个字就打一次接口
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      const who = name.trim()
      const query = who ? `?student=${encodeURIComponent(who)}` : ''
      Promise.all([
        api.get<{ items: StudentPaper[] }>(`/api/student/papers${query}`),
        who ? api.get<{ items: MyAttempt[] }>(`/api/student/attempts${query}`) : Promise.resolve({ items: [] }),
      ])
        .then(([paperRes, attemptRes]) => {
          if (!alive) return
          setPapers(paperRes.items)
          setAttempts(attemptRes.items)
        })
        .catch((err: Error) => {
          if (alive) setError(err.message)
        })
    }, 350)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [name])

  const who = name.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>学生端</h1>
        <p>这里只有老师已经发布的卷子。填一次名字，成绩和错题都会记在这里。</p>
      </header>

      <section className="card panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="field" style={{ margin: 0, minWidth: 220 }}>
          <span className="label">我的名字</span>
          <input
            className="input"
            placeholder="例如：林小满"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
          />
        </label>
        {who ? (
          <span className="muted" style={{ fontSize: 12.5 }}>
            已按「<strong>{who}</strong>」筛选成绩。换名字会看到另一份记录。
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12.5 }}>
            没填名字也能答题，但成绩不会归到你名下。
          </span>
        )}
      </section>

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

      {who && (
        <section>
          <h2 style={{ marginBottom: 10 }}>我的成绩</h2>
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
