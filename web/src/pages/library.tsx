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

  const togglePublish = async (paper: PaperSummary): Promise<void> => {
    const action = paper.status === 'published' ? 'unpublish' : 'publish'
    try {
      await api.post(`/api/papers/${paper.id}/${action}`)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = async (paper: PaperSummary): Promise<void> => {
    const confirmed = window.confirm(`删除《${paper.title}》？\n该卷的作答记录会一并删除，且不可恢复。`)
    if (!confirmed) return
    try {
      await api.del(`/api/papers/${paper.id}`)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [sort, setSort] = useState<'new' | 'old'>('new')

  const visible = (items ?? [])
    .filter((paper) => (filter === 'all' ? true : paper.status === filter))
    .filter((paper) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return (
        paper.title.toLowerCase().includes(q) ||
        paper.subject.toLowerCase().includes(q) ||
        paper.grade.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt)
      return sort === 'new' ? -cmp : cmp
    })

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

      {(items?.length ?? 0) > 0 && (
        <div className="toolbar">
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索标题 / 学科 / 年级"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="segmented">
            {([
              ['all', `全部 ${items?.length ?? 0}`],
              ['published', `已发布 ${items?.filter((p) => p.status === 'published').length ?? 0}`],
              ['draft', `草稿 ${items?.filter((p) => p.status === 'draft').length ?? 0}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <select className="input" style={{ maxWidth: 140 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="new">最新优先</option>
            <option value="old">最早优先</option>
          </select>
        </div>
      )}

      {items && items.length === 0 && (
        <div className="stage-empty">
          <div className="glyph">空</div>
          <p style={{ margin: 0 }}>还没有试卷。去「出卷」写一段大纲试试。</p>
        </div>
      )}

      {items && items.length > 0 && visible.length === 0 && (
        <div className="card panel muted">没有匹配的试卷，换个关键词或筛选条件。</div>
      )}

      <div className="lib">
        {visible.map((paper) => (
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
            <div
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className={`btn btn-sm ${paper.status === 'published' ? '' : 'btn-primary'}`}
                onClick={() => void togglePublish(paper)}
              >
                {paper.status === 'published' ? '撤回发布' : '发布'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(`/take/${paper.id}`)}>
                试答
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(`/stats/${paper.id}`)}>
                学情
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void remove(paper)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
