import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api.js'
import { generation } from '../generation.js'

interface PaperSummary {
  id: string
  title: string
  subject: string
  grade: string
  status: 'draft' | 'published'
  totalScore: number
  questionCount: number
  createdAt: string
}

export function LibraryPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<PaperSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useSyncExternalStore(generation.subscribe, generation.getSnapshot)

  const load = (): void => {
    api
      .get<{ items: PaperSummary[] }>('/api/papers')
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
  }

  useEffect(load, [])

  // 人在卷库页时后台生成完成了：自动刷一次，否则新卷要等下次进页面才出现
  useEffect(() => {
    if (run.paperId) load()
  }, [run.paperId])

  const remove = async (id: string): Promise<void> => {
    await api.del(`/api/papers/${id}`).catch((err: Error) => setError(err.message))
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1>卷库</h1>
          <p>每一份卷子都保留了生成时的模型与提示词版本，便于追溯。</p>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate('/')}>
          出新的卷子
        </button>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {items && items.length === 0 && (
        <div className="stage-empty">
          <div className="glyph">空</div>
          <p style={{ margin: 0 }}>还没有试卷。去「出卷」写一段大纲试试。</p>
        </div>
      )}

      <div className="lib">
        {items?.map((paper) => (
          <article className="card lib-card" key={paper.id} onClick={() => onNavigate(`/paper/${paper.id}`)}>
            <div style={{ display: 'flex', gap: 6 }}>
              {paper.status === 'published' ? (
                <span className="tag ok">已发布</span>
              ) : (
                <span className="tag">草稿</span>
              )}
              <span className="tag">{paper.questionCount} 题</span>
              <span className="tag">{paper.totalScore} 分</span>
            </div>
            <h3>{paper.title}</h3>
            <div className="foot">
              <span>
                {paper.subject} · {paper.grade}
              </span>
              <span className="mono">{new Date(paper.createdAt).toLocaleDateString('zh-CN')}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(`/take/${paper.id}`)}>
                试答
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(`/stats/${paper.id}`)}>
                学情
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void remove(paper.id)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
