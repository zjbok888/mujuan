import { useEffect, useState } from 'react'
import type { PaperIR } from '@shared/ir.js'
import { QUESTION_TYPE_LABEL } from '@shared/ir.js'
import { api } from '../api.js'
import { RichText } from '../components/rich-text.js'
import type { GradeResult } from '@shared/grading.js'

interface PaperResponse {
  id: string
  status: 'draft' | 'published'
  paper: PaperIR
}

export function TakePage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<PaperResponse | null>(null)
  const [student, setStudent] = useState('')
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<GradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get<PaperResponse>(`/api/papers/${id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [id])

  const setAnswer = (qid: string, value: string[]): void => {
    setAnswers((prev) => ({ ...prev, [qid]: value }))
  }

  const toggleOption = (qid: string, key: string, multiple: boolean): void => {
    const current = answers[qid] ?? []
    if (!multiple) {
      setAnswer(qid, [key])
      return
    }
    setAnswer(qid, current.includes(key) ? current.filter((k) => k !== key) : [...current, key])
  }

  const submit = async (): Promise<void> => {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ score: number; maxScore: number; result: GradeResult }>('/api/attempts', {
        paperId: data.id,
        student: student.trim() || '匿名同学',
        answers,
      })
      setResult(res.result)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) return <div className="card panel">{error}</div>
  if (!data) return <div className="stage-empty">载入中…</div>

  const questions = data.paper.sections.flatMap((s) => s.questions)
  const answered = Object.values(answers).filter((v) => v.some((x) => x.trim())).length

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card panel">
          <span className="label">交卷结果</span>
          <div className="score-hero" style={{ marginTop: 6 }}>
            <span className="n">{result.score}</span>
            <span className="d">/ {result.maxScore} 分</span>
            <span className={`tag ${result.score / result.maxScore >= 0.6 ? 'ok' : 'warn'}`}>
              得分率 {Math.round((result.score / result.maxScore) * 100)}%
            </span>
          </div>
          {result.needsReview.length > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              其中 {result.needsReview.length} 道简答题由关键词细则评分，已进入教师复核队列。
            </p>
          )}
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn btn-sm" onClick={() => onNavigate(`/stats/${id}`)}>
              查看学情
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setResult(null)}>
              再答一次
            </button>
          </div>
        </div>

        {result.results.map((item, index) => {
          const question = questions.find((q) => q.id === item.questionId)
          if (!question) return null
          return (
            <article className="card take-q" key={item.questionId}>
              <div className="qcard-head" style={{ margin: 0 }}>
                <span className="qnum">{String(index + 1).padStart(2, '0')}</span>
                <span className="tag">{QUESTION_TYPE_LABEL[question.type]}</span>
                <span className={`verdict ${item.verdict}`}>{item.detail}</span>
                <span style={{ marginLeft: 'auto' }} className="mono">
                  {item.awarded} / {item.max}
                </span>
              </div>
              <RichText className="qstem" text={question.stem} />
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                参考答案：<strong style={{ color: 'var(--seal)' }}>{question.answers.join(' / ')}</strong>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header className="paper-head">
        <div>
          <h1 className="paper-title">{data.paper.title}</h1>
          <div className="paper-meta">
            <span>
              满分 {data.paper.totalScore} 分 · {data.paper.durationMin} 分钟
            </span>
            <span>已作答 {answered}/{questions.length}</span>
            {data.status !== 'published' && <span className="tag warn">未发布（试答模式）</span>}
          </div>
        </div>
        <div className="actions">
          <input
            className="input"
            style={{ width: 180 }}
            placeholder="你的名字"
            value={student}
            onChange={(e) => setStudent(e.target.value)}
          />
          <button className="btn btn-seal" onClick={() => void submit()} disabled={busy}>
            {busy ? '评分中…' : '交卷'}
          </button>
        </div>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {questions.map((question, index) => {
        const value = answers[question.id] ?? []
        return (
          <article className="card take-q" key={question.id}>
            <div className="qcard-head" style={{ margin: 0 }}>
              <span className="qnum">{String(index + 1).padStart(2, '0')}</span>
              <span className="tag">{QUESTION_TYPE_LABEL[question.type]}</span>
              <span className="tag">{question.score} 分</span>
            </div>
            <RichText className="qstem" text={question.stem} />

            {(question.type === 'single' || question.type === 'multiple') && (
              <div style={{ display: 'grid', gap: 6 }}>
                {(question.options ?? []).map((option) => {
                  const picked = value.includes(option.key)
                  return (
                    <label className={`opt ${picked ? 'picked' : ''}`} key={option.key}>
                      <input
                        type={question.type === 'single' ? 'radio' : 'checkbox'}
                        name={question.id}
                        checked={picked}
                        onChange={() => toggleOption(question.id, option.key, question.type === 'multiple')}
                      />
                      <span className="k" style={{ transform: 'none' }}>{option.key}</span>
                      <RichText text={option.text} />
                    </label>
                  )
                })}
              </div>
            )}

            {question.type === 'blank' && (
              <div style={{ display: 'grid', gap: 8 }}>
                {question.answers.map((_, slot) => (
                  <input
                    key={slot}
                    className="input"
                    placeholder={`第 ${slot + 1} 空`}
                    value={value[slot] ?? ''}
                    onChange={(e) => {
                      const next = [...value]
                      next[slot] = e.target.value
                      setAnswer(question.id, next)
                    }}
                  />
                ))}
              </div>
            )}

            {question.type === 'short' && (
              <textarea
                className="textarea"
                style={{ minHeight: 110 }}
                placeholder="写下你的解答要点……"
                value={value[0] ?? ''}
                onChange={(e) => setAnswer(question.id, [e.target.value])}
              />
            )}
          </article>
        )
      })}

      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-seal" onClick={() => void submit()} disabled={busy}>
          {busy ? '评分中…' : '交卷'}
        </button>
      </div>
    </div>
  )
}
