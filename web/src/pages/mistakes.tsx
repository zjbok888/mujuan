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
  answers: string[]
  explanation: string
  knowledgePoints: string[]
  wrongCount: number
}

/** 错题本：把跨试卷的错题按"错了几次"排在一起，复习时只看这一页 */
export function MistakesPage() {
  const [items, setItems] = useState<Mistake[] | null>(null)
  const [point, setPoint] = useState<string>('全部')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ items: Mistake[] }>('/api/student/mistakes')
      .then((res) => setItems(res.items))
      .catch((err: Error) => {
        setError(err.message)
        setItems([])
      })
  }, [])

  const points = ['全部', ...new Set((items ?? []).flatMap((item) => item.knowledgePoints))]
  const visible = (items ?? []).filter((item) => point === '全部' || item.knowledgePoints.includes(point))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>错题本</h1>
        <p>所有做错过的题都汇总在这里，按错误次数排序。同一道题错得越多，越该先看。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {items === null ? (
        <div className="stage-empty">载入中…</div>
      ) : items.length === 0 ? (
        <div className="card panel muted">还没有错题。要么你全做对了，要么还没交过卷。</div>
      ) : (
        <>
          <div className="chips">
            {points.map((name) => (
              <button
                key={name}
                className={`chip${point === name ? ' active' : ''}`}
                onClick={() => setPoint(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {visible.map((item) => (
              <article className="card qcard" key={`${item.paperId}:${item.questionId}`}>
                <div className="qcard-head">
                  <span className={`tag${item.wrongCount > 1 ? ' seal' : ''}`}>
                    {QUESTION_TYPE_LABEL[item.type]}
                    {item.wrongCount > 1 ? ` · 错过 ${item.wrongCount} 次` : ''}
                  </span>
                  {item.knowledgePoints.slice(0, 2).map((kp) => (
                    <span className="tag" key={kp}>
                      {kp}
                    </span>
                  ))}
                </div>

                <RichText className="qstem" text={item.stem} />

                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 10 }}>
                  <span>正确答案：</span>
                  <div style={{ color: 'var(--seal)', fontWeight: 600, lineHeight: 1.8 }}>
                    <RichText text={item.answers.join(' / ')} />
                  </div>
                  {item.explanation && (
                    <div className="explain" style={{ marginTop: 8 }}>
                      <span className="label">解析</span>
                      <RichText text={item.explanation} />
                    </div>
                  )}
                </div>


              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
