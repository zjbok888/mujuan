import { useEffect, useState } from 'react'
import { QUESTION_TYPE_LABEL } from '@shared/ir.js'
import { api } from '../api.js'
import { RichText } from '../components/rich-text.js'

interface ReviewQuestion {
  index: number
  question: {
    id: string
    type: 'single' | 'multiple' | 'blank' | 'short'
    stem: string
    options: Array<{ key: string; text: string }>
    answers: string[]
    explanation: string
    knowledgePoints: string[]
  }
  awarded: number
  max: number
  verdict: 'correct' | 'partial' | 'wrong'
  /** 早期记录没有存原始作答，可能为 undefined */
  myAnswer?: string[]
}

interface ReviewResponse {
  attempt: {
    id: string
    student: string
    submittedAt: string
    score: number
    maxScore: number
  }
  paper: { id: string; title: string; subject: string; grade: string } | null
  review: ReviewQuestion[]
}

/** 让学生把一道错题丢给 AI 助手讲解 */
function askAssistant(text: string, paperId?: string): void {
  window.dispatchEvent(new CustomEvent('mujuan:assistant-ask', { detail: { text, paperId } }))
}

export function ReviewPage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<ReviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<ReviewResponse>(`/api/attempts/${id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (error) return <div className="card panel">{error}</div>
  if (!data) return <div className="stage-empty">载入中…</div>

  const { attempt, paper, review } = data
  const percent = attempt.maxScore > 0 ? Math.round((attempt.score / attempt.maxScore) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header className="paper-head">
        <div>
          <h1 className="paper-title">错题回顾</h1>
          <div className="paper-meta">
            <span>{paper?.title ?? '（试卷已删除）'}</span>
            <span>{attempt.student}</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {new Date(attempt.submittedAt).toLocaleString('zh-CN')}
            </span>
          </div>
        </div>
        <div className="actions">
          {paper && (
            <button className="btn btn-sm" onClick={() => onNavigate(`/take/${paper.id}`)}>
              再做一遍
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => onNavigate('/student')}>
            返回学生端
          </button>
        </div>
      </header>

      <div className="card panel">
        <div className="score-hero">
          <span className="n">{attempt.score}</span>
          <span className="d">/ {attempt.maxScore} 分</span>
          <span className={`tag ${percent >= 60 ? 'ok' : 'warn'}`}>得分率 {percent}%</span>
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
          {review.length === 0 ? '这份卷子全部答对了，没有需要回顾的题。' : `本次共有 ${review.length} 道题没拿满分，下面逐题对照。`}
        </p>
      </div>

      {review.map((item) => (
        <article className="card panel" key={item.question.id}>
          <div className="qcard-head" style={{ marginBottom: 10 }}>
            <span className="qnum">{String(item.index).padStart(2, '0')}</span>
            <span className="tag">{QUESTION_TYPE_LABEL[item.question.type]}</span>
            <span className={`verdict ${item.verdict}`}>
              {item.verdict === 'partial' ? '部分正确' : '答错'}
            </span>
            <span style={{ marginLeft: 'auto' }} className="mono">
              {item.awarded} / {item.max}
            </span>
          </div>

          <RichText className="qstem" text={item.question.stem} />

          {item.question.options.length > 0 && (
            <ul className="qoptions">
              {item.question.options.map((option) => {
                const mine = item.myAnswer?.includes(option.key) ?? false
                const right = item.question.answers.includes(option.key)
                return (
                  <li
                    key={option.key}
                    className={`${right ? 'opt-right' : ''}${mine && !right ? ' opt-wrong' : ''}`.trim()}
                  >
                    <span className="k">{option.key}</span>
                    <RichText text={option.text} />
                    {right && <span className="opt-flag ok">正确答案</span>}
                    {mine && !right && <span className="opt-flag err">你选的</span>}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="answer-compare">
            <div>
              <span className="label">你的答案</span>
              <div className="val err">
                {item.myAnswer === undefined
                  ? '（这条早期记录没有保存作答）'
                  : item.myAnswer.length > 0
                    ? item.myAnswer.join(' / ')
                    : '（未作答）'}
              </div>
            </div>
            <div>
              <span className="label">正确答案</span>
              <div className="val ok">{item.question.answers.join(' / ')}</div>
            </div>
          </div>

          {item.question.explanation && (
            <div className="explain">
              <span className="label">解析</span>
              <RichText text={item.question.explanation} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm"
              onClick={() =>
                askAssistant(
                  `第 ${item.index} 题我做错了，帮我讲讲这道题考的是什么、我错在哪、下次怎么避免。`,
                  paper?.id,
                )
              }
            >
              让 AI 讲讲这题
            </button>
            {item.question.knowledgePoints.length > 0 && (
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                知识点：{item.question.knowledgePoints.join('、')}
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
