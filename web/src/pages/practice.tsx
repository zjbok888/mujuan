import { useEffect, useState } from 'react'
import { QUESTION_TYPE_LABEL, type Question } from '@shared/ir.js'
import { api } from '../api.js'
import { RichText } from '../components/rich-text.js'

interface Mistake {
  questionId: string
  paperId: string
  paperTitle: string
  type: Question['type']
  stem: string
  options: Array<{ key: string; text: string }>
  answers: string[]
  explanation: string
  knowledgePoints: string[]
}

/** 练习：从错题本挑题重做，**本地判分**——不写库，不污染学情 */
export function PracticePage() {
  const [pool, setPool] = useState<Mistake[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ items: Mistake[] }>('/api/student/mistakes')
      .then((res) => {
        setPool(res.items)
        setPicked(res.items.slice(0, 5).map((item) => item.questionId))
      })
      .catch((err: Error) => {
        setError(err.message)
        setPool([])
      })
  }, [])

  const questions = (pool ?? []).filter((item) => picked.includes(item.questionId))

  const toggle = (item: Mistake): void => {
    setPicked((prev) =>
      prev.includes(item.questionId) ? prev.filter((id) => id !== item.questionId) : [...prev, item.questionId],
    )
    setSubmitted(false)
  }

  const pick = (id: string, key: string, multiple: boolean): void => {
    setAnswers((prev) => {
      const current = prev[id] ?? []
      if (!multiple) return { ...prev, [id]: [key] }
      return {
        ...prev,
        [id]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
      }
    })
  }

  /** 客观题按集合比对；简答题没有评分细则，标记为待自评而不是乱判 */
  const judge = (q: Mistake): 'correct' | 'wrong' | 'self' => {
    if (q.type === 'short') return 'self'
    const mine = [...(answers[q.questionId] ?? [])].map((s) => s.trim().toLowerCase()).sort()
    const right = [...q.answers].map((s) => s.trim().toLowerCase()).sort()
    if (mine.length === 0) return 'wrong'
    return mine.length === right.length && mine.every((v, i) => v === right[i]) ? 'correct' : 'wrong'
  }

  const objective = questions.filter((q) => q.type !== 'short')
  const correct = objective.filter((q) => judge(q) === 'correct').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>练习</h1>
        <p>从错题本里挑几道重做。判分在本地完成，不写入学情——练坏了也不影响成绩。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {pool === null ? (
        <div className="stage-empty">载入中…</div>
      ) : pool.length === 0 ? (
        <div className="card panel muted">错题本还是空的，先去交一套卷子。</div>
      ) : (
        <>
          <div className="card panel">
            <span className="label">选择要练的错题（默认前 5 道）</span>
            <div className="chips" style={{ marginTop: 8 }}>
              {pool.map((item) => (
                <button
                  key={item.questionId}
                  className={`chip${picked.includes(item.questionId) ? ' active' : ''}`}
                  onClick={() => toggle(item)}
                  title={item.knowledgePoints.join('、')}
                >
                  {QUESTION_TYPE_LABEL[item.type]} · {item.knowledgePoints[0] ?? '未标注'}
                </button>
              ))}
            </div>
          </div>

          {questions.map((q) => {
            const verdict = submitted ? judge(q) : null
            return (
              <article className="card qcard" key={q.questionId}>
                <div className="qcard-head">
                  <span className="tag">{QUESTION_TYPE_LABEL[q.type]}</span>
                  {verdict === 'correct' && <span className="tag ok">正确</span>}
                  {verdict === 'wrong' && <span className="tag seal">错误</span>}
                  {verdict === 'self' && <span className="tag warn">待自评</span>}
                </div>

                <RichText className="qstem" text={q.stem} />

                {q.options.length > 0 ? (
                  <div className="qoptions">
                    {q.options.map((option) => {
                      const on = (answers[q.questionId] ?? []).includes(option.key)
                      return (
                        <label className={`opt${on ? ' picked' : ''}`} key={option.key}>
                          <input
                            type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                            name={q.questionId}
                            checked={on}
                            onChange={() => pick(q.questionId, option.key, q.type === 'multiple')}
                          />
                          <span className="k" style={{ transform: 'none' }}>{option.key}</span>
                          <RichText text={option.text} />
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    className="input"
                    style={{ marginTop: 10 }}
                    placeholder="填写答案"
                    value={(answers[q.questionId] ?? [])[0] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [q.questionId]: [e.target.value] })}
                  />
                )}

                {submitted && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 10 }}>
                    <span>正确答案：</span>
                    <div style={{ color: 'var(--seal)', fontWeight: 600 }}>
                      <RichText text={q.answers.join(' / ')} />
                    </div>
                    {q.explanation && (
                      <div className="explain" style={{ marginTop: 8 }}>
                        <span className="label">解析</span>
                        <RichText text={q.explanation} />
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}

          <div className="actions">
            <button className="btn btn-primary" onClick={() => setSubmitted(true)} disabled={questions.length === 0}>
              交卷（本地判分）
            </button>
            <button className="btn" onClick={() => setSubmitted(false)}>
              重做
            </button>
            {submitted && (
              <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
                客观题 {correct} / {objective.length} 正确
                {questions.length > objective.length ? '（简答题请对照参考答案自评）' : ''}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
