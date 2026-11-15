import { useEffect, useRef, useState } from 'react'
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

export function TakePage({ id, studentName, onNavigate }: { id: string; studentName?: string; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<PaperResponse | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<GradeResult | null>(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const deadlineRef = useRef<number | null>(null)
  const autoRef = useRef(false)
  const submitRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    api
      .get<PaperResponse>(`/api/papers/${id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [id])

  // 计时：进入卷面即开始，到点自动交卷（只触发一次，避免重复提交）
  useEffect(() => {
    if (!data || result) return
    if (deadlineRef.current === null) {
      deadlineRef.current = Date.now() + data.paper.durationMin * 60_000
    }
    const tick = (): void => {
      const left = Math.max(0, Math.round(((deadlineRef.current ?? 0) - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0 && !autoRef.current) {
        autoRef.current = true
        setTimedOut(true)
        void submitRef.current()
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [data, result])

  const restart = (): void => {
    deadlineRef.current = null
    autoRef.current = false
    setTimedOut(false)
    setRemaining(null)
    setAnswers({})
    setResult(null)
  }

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
      const res = await api.post<{
        score: number
        maxScore: number
        preview: boolean
        result: GradeResult
      }>('/api/attempts', {
        paperId: data.id,
        answers,
      })
      setResult(res.result)
      setPreview(res.preview)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 计时器每秒触发一次，闭包里会拿到旧的 submit / answers，
  // 所以统一走 ref 取最新一版，到点时才能交上真实作答。
  submitRef.current = submit

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
          {preview && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              这是发布前的试答：分数照常计算，但 <strong>不计入学情统计</strong>。发布后再交卷才是正式成绩。
            </p>
          )}
          {result.needsReview.length > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              其中 {result.needsReview.length} 道简答题由关键词细则评分，已进入教师复核队列。
            </p>
          )}
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn btn-sm" onClick={() => onNavigate(`/stats/${id}`)}>
              查看学情
            </button>
            <button className="btn btn-sm btn-ghost" onClick={restart}>
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
                <span>参考答案：</span>
                <div style={{ color: 'var(--seal)', fontWeight: 600, lineHeight: 1.8 }}>
                  <RichText text={question.answers.join(' / ')} />
                </div>
                {question.explanation && (
                  <div className="explain" style={{ marginTop: 8 }}>
                    <span className="label">解析</span>
                    <RichText text={question.explanation} />
                  </div>
                )}
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
            {studentName && <span className="tag">{studentName}</span>}
            {remaining !== null && (
              <span
                className={`countdown${remaining <= 60 ? ' err' : remaining <= 300 ? ' warn' : ''}`}
                title="考试时间到会自动交卷"
              >
                剩余 {String(Math.floor(remaining / 60)).padStart(2, '0')}:
                {String(remaining % 60).padStart(2, '0')}
              </span>
            )}
            {data.status !== 'published' && <span className="tag warn">未发布（试答模式）</span>}
          </div>
        </div>
        <div className="actions">

          <button className="btn btn-seal" onClick={() => void submit()} disabled={busy}>
            {busy ? '评分中…' : '交卷'}
          </button>
        </div>
      </header>

      {error && <div className="statusbar err">{error}</div>}
      {timedOut && !result && (
        <div className="statusbar warn">时间到，已自动交卷。评分结果见上方。</div>
      )}

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
