import { useEffect, useState } from 'react'
import type { PaperIR, Question } from '@shared/ir.js'
import { paperStats, QUESTION_TYPE_LABEL } from '@shared/ir.js'
import { api } from '../api.js'
import { QuestionView } from '../components/question-view.js'

interface PaperResponse {
  id: string
  status: 'draft' | 'published'
  createdAt: string
  paper: PaperIR
  attempts: number
}

export function PaperPage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<PaperResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ stem: string; answers: string; score: number }>({
    stem: '',
    answers: '',
    score: 0,
  })
  const [busy, setBusy] = useState(false)
  // 教师版：显示答案与解析，打印时一并输出
  const [showKey, setShowKey] = useState(false)

  const load = (): void => {
    api
      .get<PaperResponse>(`/api/papers/${id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }

  useEffect(load, [id])

  // 草稿默认给老师看答案，已发布默认给学生版；之后以按钮状态为准
  useEffect(() => {
    if (!data) return
    setShowKey(data.status !== 'published')
  }, [data?.status])

  // 助手改完题会广播这个事件：页面必须重新拉一次，否则老师看到的是旧题干
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ paperId?: string }>).detail
      if (!detail?.paperId || detail.paperId === id) load()
    }
    window.addEventListener('mujuan:paper-updated', handler)
    return () => window.removeEventListener('mujuan:paper-updated', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const patchLocal = (question: Question): void => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        paper: {
          ...prev.paper,
          sections: prev.paper.sections.map((section) => ({
            ...section,
            questions: section.questions.map((q) => (q.id === question.id ? question : q)),
          })),
        },
      }
    })
  }

  const beginEdit = (question: Question): void => {
    setEditing(question.id)
    setDraft({ stem: question.stem, answers: question.answers.join(' / '), score: question.score })
  }

  const save = async (question: Question): Promise<void> => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        stem: draft.stem,
        score: draft.score,
      }
      if (question.type === 'single' || question.type === 'multiple') {
        body.answers = draft.answers
          .split('/')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      } else {
        body.answers = draft.answers.split('/').map((s) => s.trim()).filter(Boolean)
      }
      const res = await api.patch<{ question: Question }>(`/api/papers/${id}/questions/${question.id}`, body)
      patchLocal(res.question)
      setEditing(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const togglePublish = async (): Promise<void> => {
    if (!data) return
    setBusy(true)
    try {
      const action = data.status === 'published' ? 'unpublish' : 'publish'
      await api.post(`/api/papers/${id}/${action}`)
      setData({ ...data, status: action === 'publish' ? 'published' : 'draft' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) {
    return (
      <div className="card panel">
        <p>{error}</p>
        <button className="btn" onClick={() => onNavigate('/library')}>
          返回卷库
        </button>
      </div>
    )
  }

  if (!data) return <div className="stage-empty">载入中…</div>

  const stats = paperStats(data.paper)
  const questions = data.paper.sections.flatMap((s) => s.questions)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="paper-head">
        <div>
          <h1 className="paper-title">{data.paper.title}</h1>
          <div className="paper-meta">
            <span>
              {data.paper.subject} · {data.paper.grade}
            </span>
            <span>
              满分 {data.paper.totalScore} · {data.paper.durationMin} 分钟 · {stats.count} 题
            </span>
            <span>
              {data.status === 'published' ? (
                <span className="tag ok">已发布</span>
              ) : (
                <span className="tag">草稿</span>
              )}
            </span>
            <span>提交 {data.attempts} 份</span>
            <span className="mono">{data.paper.meta.model} · {data.paper.meta.promptVersion}</span>
          </div>
        </div>

        <div className="actions">
          <button
            className={`btn btn-sm${showKey ? ' btn-primary' : ''}`}
            onClick={() => setShowKey((prev) => !prev)}
            title="打开后试卷会附带答案与解析，打印即为教师版"
          >
            {showKey ? '教师版（含答案）' : '学生版'}
          </button>
          <button className="btn btn-sm" onClick={() => window.print()}>
            打印 / 存 PDF
          </button>
          <a className="btn btn-sm" href={`/api/papers/${id}/paper.json`} download>
            导出 IR
          </a>
          <button className="btn btn-sm" onClick={() => onNavigate(`/stats/${id}`)}>
            学情
          </button>
          <button className="btn btn-sm" onClick={() => onNavigate(`/take/${id}`)}>
            试答
          </button>
          <button className="btn btn-sm btn-seal" onClick={togglePublish} disabled={busy}>
            {data.status === 'published' ? '撤回发布' : '发布'}
          </button>
        </div>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      <div className="card panel" style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12.5 }}>
        {(Object.keys(stats.byType) as Array<keyof typeof stats.byType>)
          .filter((type) => stats.byType[type] > 0)
          .map((type) => (
            <span key={type}>
              {QUESTION_TYPE_LABEL[type]} <strong>{stats.byType[type]}</strong>
            </span>
          ))}
        <span>
          知识点覆盖 <strong>{stats.knowledgePoints.length}</strong> 个
        </span>
        <span className="muted">分值合计 {stats.scoreSum}</span>
      </div>

      <div className="qlist">
        {questions.map((question, index) => (
          <div key={question.id}>
            <QuestionView index={index} question={question} showAnswer={showKey} />
            <div className="actions" style={{ marginTop: 8, paddingLeft: 4 }}>
              {editing === question.id ? (
                <div className="card panel editbox" style={{ flex: 1 }}>
                  <label className="field">
                    <span className="label">题干（支持 Markdown 与 $LaTeX$）</span>
                    <textarea
                      className="textarea"
                      value={draft.stem}
                      onChange={(e) => setDraft({ ...draft, stem: e.target.value })}
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <label className="field">
                      <span className="label">
                        答案（{question.type === 'single' || question.type === 'multiple' ? '选项 key，用 / 分隔' : '多个答案用 / 分隔'}）
                      </span>
                      <input
                        className="input"
                        value={draft.answers}
                        onChange={(e) => setDraft({ ...draft, answers: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span className="label">分值</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={100}
                        value={draft.score}
                        onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) || 1 })}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => void save(question)} disabled={busy}>
                      保存
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-sm" onClick={() => beginEdit(question)}>
                  编辑此题
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showKey && (
        <section className="card panel answer-key">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>答案速查</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              教师版：打印时会一并输出，学生版请先关闭「答案解析」
            </span>
          </div>
          <table className="plain">
            <thead>
              <tr>
                <th style={{ width: 56 }}>题号</th>
                <th style={{ width: 80 }}>题型</th>
                <th>答案</th>
                <th style={{ width: 60 }}>分值</th>
                <th>知识点</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question, index) => (
                <tr key={question.id}>
                  <td className="mono">{String(index + 1).padStart(2, '0')}</td>
                  <td>{QUESTION_TYPE_LABEL[question.type]}</td>
                  <td style={{ color: 'var(--seal)', fontWeight: 600 }}>
                    {question.answers.join(' / ')}
                  </td>
                  <td>{question.score}</td>
                  <td className="muted">{question.knowledgePoints.join('、') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
