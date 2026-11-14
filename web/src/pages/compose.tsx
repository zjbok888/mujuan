import { useEffect, useMemo, useRef, useState } from 'react'
import type { Blueprint, GenerateRequest, Question, QuestionType } from '@shared/ir.js'
import { DEFAULT_GENERATE_REQUEST, QUESTION_TYPE_LABEL } from '@shared/ir.js'
import type { ServerEvent, ValidationIssue } from '@shared/events.js'
import { streamGenerate } from '../api.js'
import { QuestionView } from '../components/question-view.js'

const SAMPLE_OUTLINE = `人教版高中数学选择性必修二 · 第五章《导数及其应用》

本节覆盖以下内容：
1. 导数的定义与几何意义（切线斜率）；
2. 基本求导公式与四则运算法则；
3. 利用导数判断函数的单调性与极值；
4. 闭区间上函数的最大值与最小值；
5. 导数在实际优化问题中的简单应用。

学生易错点：把"导数为零"直接当成"极值点"、忽略定义域、极值与最值混淆。`

const TYPES: QuestionType[] = ['single', 'multiple', 'blank', 'short']

type Phase = 'idle' | 'running' | 'done' | 'error'

const DIFF_COLORS = ['#dcd2c0', '#c9b79a', '#b99a6c', '#c1723f', '#b23a2b']

export function ComposePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [subject, setSubject] = useState(DEFAULT_GENERATE_REQUEST.subject)
  const [grade, setGrade] = useState(DEFAULT_GENERATE_REQUEST.grade)
  const [totalScore, setTotalScore] = useState(DEFAULT_GENERATE_REQUEST.totalScore)
  const [durationMin, setDurationMin] = useState(DEFAULT_GENERATE_REQUEST.durationMin)
  const [outline, setOutline] = useState('')
  const [mix, setMix] = useState<Record<QuestionType, number>>({ single: 4, multiple: 0, blank: 2, short: 1 })

  const [phase, setPhase] = useState<Phase>('idle')
  const [thinking, setThinking] = useState('')
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [items, setItems] = useState<Array<Question | null>>([])
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const [repair, setRepair] = useState<string | null>(null)
  const [paperId, setPaperId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const abortRef = useRef<(() => void) | null>(null)
  const failedRef = useRef(false)
  const autoStartedRef = useRef(false)

  useEffect(() => () => abortRef.current?.(), [])

  const questionCount = useMemo(() => Object.values(mix).reduce((a, b) => a + b, 0), [mix])
  const filled = useMemo(() => items.filter(Boolean).length, [items])

  const handleEvent = (event: ServerEvent): void => {
    switch (event.type) {
      case 'reasoning.delta':
        setThinking((prev) => (prev + event.text).slice(-1600))
        break
      case 'plan.done':
        setBlueprint(event.blueprint)
        break
      case 'item.done':
        setItems((prev) => {
          const next = [...prev]
          next[event.index] = event.question
          return next
        })
        break
      case 'validate.report':
        setIssues(event.issues)
        break
      case 'repair.attempt':
        setRepair(`第 ${event.round}/${event.maxRounds} 轮修复：${event.reason}`)
        break
      case 'paper.done':
        setPaperId(event.paperId)
        break
      case 'error':
        if (event.code === 'PARTIAL') setWarning(event.message)
        else {
          failedRef.current = true
          setError(event.message)
        }
        break
      case 'done':
        setPhase(failedRef.current ? 'error' : 'done')
        break
      default:
        break
    }
  }

  const start = (overrideOutline?: string): void => {
    abortRef.current?.()
    failedRef.current = false
    setPhase('running')
    setThinking('')
    setBlueprint(null)
    setIssues(null)
    setRepair(null)
    setPaperId(null)
    setError(null)
    setWarning(null)

    const count = Object.values(mix).reduce((a, b) => a + b, 0)
    setItems(Array.from({ length: count }, () => null))

    const request: GenerateRequest = {
      outline: (overrideOutline ?? outline).trim(),
      subject,
      grade,
      totalScore,
      durationMin,
      mix: TYPES.filter((type) => mix[type] > 0).map((type) => ({ type, count: mix[type] })),
    }

    abortRef.current = streamGenerate(
      request,
      handleEvent,
      (message) => {
        failedRef.current = true
        setError(message)
        setPhase('error')
      },
    )
  }

  const running = phase === 'running'
  const canStart = outline.trim().length >= 8 && questionCount > 0 && !running
  const progress = questionCount === 0 ? 0 : Math.round((filled / questionCount) * 100)

  // ?demo=1：打开页面即自动用示例大纲走一遍生成，方便录屏与现场演示
  useEffect(() => {
    if (autoStartedRef.current) return
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return
    autoStartedRef.current = true
    setOutline(SAMPLE_OUTLINE)
    const timer = setTimeout(() => start(SAMPLE_OUTLINE), 400)
    return () => clearTimeout(timer)
    // 只在首次挂载时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="compose">
      <section className="card panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2>出卷指令</h2>
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
            用一段话描述这节课教了什么。模型只负责出题，结构与分值由系统约束。
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span className="label">学科</span>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">年级</span>
            <input className="input" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span className="label">总分</span>
            <input
              className="input"
              type="number"
              min={10}
              max={150}
              value={totalScore}
              onChange={(e) => setTotalScore(Math.min(150, Math.max(10, Number(e.target.value) || 10)))}
            />
          </label>
          <label className="field">
            <span className="label">时长（分钟）</span>
            <input
              className="input"
              type="number"
              min={10}
              max={180}
              value={durationMin}
              onChange={(e) => setDurationMin(Math.min(180, Math.max(10, Number(e.target.value) || 45)))}
            />
          </label>
        </div>

        <div>
          <span className="label">题型配比</span>
          {TYPES.map((type) => (
            <div className="mix-row" key={type}>
              <span style={{ fontSize: 13 }}>{QUESTION_TYPE_LABEL[type]}</span>
              <div className="stepper">
                <button
                  type="button"
                  aria-label={`减少${QUESTION_TYPE_LABEL[type]}`}
                  disabled={mix[type] <= 0 || running}
                  onClick={() => setMix((prev) => ({ ...prev, [type]: Math.max(0, prev[type] - 1) }))}
                >
                  −
                </button>
                <span className="count">{mix[type]}</span>
                <button
                  type="button"
                  aria-label={`增加${QUESTION_TYPE_LABEL[type]}`}
                  disabled={mix[type] >= 12 || running}
                  onClick={() => setMix((prev) => ({ ...prev, [type]: Math.min(12, prev[type] + 1) }))}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <label className="field">
          <span className="label">教学大纲 / 本课内容</span>
          <textarea
            className="textarea"
            placeholder="粘贴讲义要点、考点清单、易错点……"
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canStart) start()
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => start()} disabled={!canStart}>
            {running ? '命题中…' : '生成试卷'}
          </button>
          <button className="btn" onClick={() => setOutline(SAMPLE_OUTLINE)} disabled={running}>
            填入示例
          </button>
        </div>

        <div className="muted" style={{ fontSize: 11.5, display: 'flex', justifyContent: 'space-between' }}>
          <span>
            共 {questionCount} 题 · 合计 {totalScore} 分 · {durationMin} 分钟
          </span>
          <span className="mono">⌘/Ctrl + ↵</span>
        </div>
      </section>

      <section className="stage">
        {thinking && (
          <details className="thinking" open={running}>
            <summary>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--seal)',
                  display: 'inline-block',
                }}
              />
              模型思考过程{running ? '（实时）' : ''}
            </summary>
            <div className="stream">
              {thinking}
              {running && <i className="caret" />}
            </div>
          </details>
        )}

        {blueprint && (
          <div className="card blueprint">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className="title">命题蓝图</span>
              <span className="tag">
                {questionCount} 题 · {totalScore} 分
              </span>
            </div>
            <div className="chips">
              {blueprint.coverage.map((kp) => (
                <span className="chip" key={kp}>
                  {kp}
                </span>
              ))}
            </div>
            <div className="diff-bar" title="难度分布 D1-D5">
              {(['d1', 'd2', 'd3', 'd4', 'd5'] as const).map((key, i) => {
                const count = blueprint.difficulty[key] ?? 0
                const width = questionCount === 0 ? 0 : (count / questionCount) * 100
                return <i key={key} style={{ width: `${width}%`, background: DIFF_COLORS[i] }} />
              })}
            </div>
            {blueprint.rationale && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{blueprint.rationale}</p>
            )}
          </div>
        )}

        {(running || issues) && (
          <div
            className={`statusbar ${
              error ? 'err' : warning || (issues && issues.length > 0) ? 'warn' : issues ? 'ok' : ''
            }`}
          >
            <span>
              {running
                ? `正在命题 ${filled}/${questionCount}`
                : issues
                  ? issues.length === 0
                    ? '校验通过'
                    : `${issues.length} 处待处理`
                  : ''}
            </span>
            <div style={{ flex: 1, height: 4, background: 'rgba(0,0,0,.07)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${issues && !running ? 100 : progress}%`,
                  height: '100%',
                  background: error ? 'var(--seal)' : 'var(--ink)',
                  transition: 'width .35s ease',
                }}
              />
            </div>
            {repair && (
              <span className="mono" style={{ fontSize: 11 }}>
                {repair}
              </span>
            )}
            {issues && issues.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 11.5 }}>详情</summary>
                <div style={{ fontSize: 11.5, marginTop: 6, maxWidth: 460 }}>
                  {issues.slice(0, 5).map((issue) => (
                    <div key={`${issue.code}-${issue.path}`}>· {issue.message}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {error && (
          <div className="statusbar err" style={{ justifyContent: 'space-between' }}>
            <span>{error}</span>
            <button className="btn btn-sm" onClick={() => start()}>
              重试
            </button>
          </div>
        )}

        {warning && !error && (
          <div className="statusbar warn">
            <span>{warning}</span>
          </div>
        )}

        {paperId && (
          <div className="card panel" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 18px' }}>
            <span style={{ fontSize: 13 }}>
              试卷已生成{issues && issues.length > 0 ? '（含待复核项）' : ''}，可以进入编辑与发布。
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => onNavigate(`/paper/${paperId}`)}>
                打开试卷
              </button>
              <button className="btn btn-sm btn-seal" onClick={() => onNavigate(`/take/${paperId}`)}>
                立即试答
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !running && (
          <div className="stage-empty">
            <div className="glyph">卷</div>
            <p style={{ margin: 0 }}>左侧写下这节课教了什么，右边会逐题长出试卷。</p>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              生成过程可中断，已完成的题目不会丢失。
            </p>
          </div>
        )}

        <div className="qlist">
          {items.map((item, index) =>
            item ? (
              <QuestionView key={item.id} index={index} question={item} compact />
            ) : running ? (
              <div className="skeleton" key={`sk-${index}`} />
            ) : null,
          )}
        </div>
      </section>
    </div>
  )
}
