import type { Question } from '@shared/ir.js'
import { DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from '@shared/ir.js'
import { RichText } from './rich-text.js'

const STATUS_TAG: Record<Question['status'], { text: string; cls: string } | null> = {
  ai: null,
  verified: { text: '已校验', cls: 'ok' },
  'needs-review': { text: '待复核', cls: 'warn' },
  edited: { text: '已人工修改', cls: 'seal' },
}

export function QuestionView({
  index,
  question,
  showAnswer = false,
  compact = false,
}: {
  index: number
  question: Question
  showAnswer?: boolean
  compact?: boolean
}) {
  const status = STATUS_TAG[question.status]

  return (
    <article className={compact ? 'qcard qcard-compact' : 'qcard'}>
      <div className="qcard-head">
        <span className="qnum">{String(index + 1).padStart(2, '0')}</span>
        <span className="tag">{QUESTION_TYPE_LABEL[question.type]}</span>
        <span className="tag">{question.score} 分</span>
        <span className="tag">
          {DIFFICULTY_LABEL[question.difficulty as 1 | 2 | 3 | 4 | 5] ?? '未标注'}
        </span>
        {status && <span className={`tag ${status.cls}`}>{status.text}</span>}
      </div>

      <RichText className="qstem" text={question.stem} />

      {question.options && question.options.length > 0 && (
        <ul className="qoptions">
          {question.options.map((option) => (
            <li key={option.key}>
              <span className="k">{option.key}</span>
              <RichText text={option.text} />
            </li>
          ))}
        </ul>
      )}

      {showAnswer && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <span className="label">参考答案　</span>
          <span style={{ color: 'var(--seal)', fontWeight: 600 }}>{question.answers.join(' / ')}</span>
          {question.keywordRubric && question.keywordRubric.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>
              评分要点：
              {question.keywordRubric.map((r) => `${r.keyword}(${r.points}分)`).join('、')}
            </div>
          )}
          {question.explanation && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>
              <RichText text={question.explanation} />
            </div>
          )}
        </div>
      )}

      {!compact && (
        <div className="qmeta">
          <span>知识点：{question.knowledgePoints.join('、') || '未标注'}</span>
          <span className="mono">{question.id}</span>
        </div>
      )}
    </article>
  )
}
