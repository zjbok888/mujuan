import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantContext, AssistantEvent } from '@shared/assistant.js'
import { streamAssistant } from '../api.js'
import { RichText } from './rich-text.js'

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 动作结果的旁注：正在改 / 已改好 / 失败 */
  note?: string
  tone?: 'ok' | 'err' | 'busy'
}

const GREETING: Record<'teacher' | 'student', Message> = {
  teacher: {
    role: 'assistant',
    content:
      '我是命题助手。可以问我怎么把大纲写得更可考，也可以直接让我动手——比如「把第 3 题改难一点」「第 5 题的解析写详细些」。',
  },
  student: {
    role: 'assistant',
    content:
      '我是学习助手。哪道题不懂就问我，我会讲这道题考什么、你错在哪、下次怎么避开。',
  },
}

const PLACEHOLDER: Record<'teacher' | 'student', string> = {
  teacher: '比如：把第 3 题改难一点 / 这份卷子偏简单，怎么调？',
  student: '比如：第 2 题为什么选 C 不选 A？',
}

const PANEL_W = 420
const PANEL_H = 620
const MARGIN = 12

function loadPos(key: string): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { x?: number; y?: number }
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return clamp(parsed.x, parsed.y, PANEL_W, PANEL_H)
  } catch {
    return null
  }
}

function clamp(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN)
  return { x: Math.min(Math.max(MARGIN, x), maxX), y: Math.min(Math.max(MARGIN, y), maxY) }
}

/**
 * 拖动：按下记起点，移动超过 3px 才认作拖拽（否则算点击）。
 * 位置存 localStorage，下次打开还在原地；双击标题栏复位到居中。
 */
function useDraggable(storageKey: string, width: number, height: number) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPos(storageKey))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const latest = useRef(pos)
  latest.current = pos
  // 松手后浏览器还会补一个 click，用这个标记把它和"真的点击"区分开。
  // 不能用 state：pointerup 里 setState 是异步的，click 处理器读到的还是旧值。
  const lastMoved = useRef(false)

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = { sx: event.clientX, sy: event.clientY, ox: rect.left, oy: rect.top, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current
    if (!state) return
    const dx = event.clientX - state.sx
    const dy = event.clientY - state.sy
    if (!state.moved && Math.abs(dx) + Math.abs(dy) <= 3) return
    state.moved = true
    setPos(clamp(state.ox + dx, state.oy + dy, width, height))
  }

  const onPointerUp = (): void => {
    const state = drag.current
    drag.current = null
    setDragging(false)
    lastMoved.current = state?.moved ?? false
    if (state?.moved && latest.current) {
      localStorage.setItem(storageKey, JSON.stringify(latest.current))
    }
  }

  const reset = useCallback((): void => {
    localStorage.removeItem(storageKey)
    setPos(null)
  }, [storageKey])

  /** 取走"刚刚是拖拽"这一事实，取完即清 */
  const consumeDrag = useCallback((): boolean => {
    const moved = lastMoved.current
    lastMoved.current = false
    return moved
  }, [])

  // 窗口变小后把窗口拉回可视区，别让它飘到屏幕外
  useEffect(() => {
    const onResize = (): void => {
      setPos((prev) => (prev ? clamp(prev.x, prev.y, width, height) : prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [width, height])

  return {
    pos,
    dragging,
    reset,
    consumeDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

/**
 * 全局 AI 助手：居中悬浮窗，标题栏可拖动，收起后变成可拖动的小浮球。
 * 它不只是聊天——模型可以在回答末尾挂一个动作块，服务端会真的去改题。
 */
export function Assistant({
  context,
  role = 'teacher',
}: {
  context: AssistantContext
  /** 两端各用各的接口和提示词：教师端能改题，学生端只能讲解 */
  role?: 'teacher' | 'student'
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([GREETING[role]])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 由外部页面（错题回顾）指定的试卷，面板标题要据此显示 */
  const [overridePaperId, setOverridePaperId] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sendRef = useRef<(text: string, paperId?: string) => void>(() => {})

  useEffect(() => {
    const onAsk = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: string; paperId?: string }>).detail
      if (!detail?.text) return
      setOpen(true)
      if (detail.paperId) setOverridePaperId(detail.paperId)
      // 等面板挂载后再发，否则消息列表还没渲染
      window.setTimeout(() => sendRef.current(detail.text ?? '', detail.paperId), 60)
    }
    window.addEventListener('mujuan:assistant-ask', onAsk)
    return () => window.removeEventListener('mujuan:assistant-ask', onAsk)
  }, [])

  const panel = useDraggable('mujuan:assistant:panel', PANEL_W, Math.min(PANEL_H, window.innerHeight - 48))
  const fab = useDraggable('mujuan:assistant:fab', 58, 58)

  useEffect(() => () => abortRef.current?.(), [])

  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  // Esc 关闭：没有遮罩，键盘是主要的退出方式
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const patchLast = (patch: Partial<Message>): void => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last) next[next.length - 1] = { ...last, ...patch }
      return next
    })
  }

  /**
   * 发送一条消息。
   * paperIdOverride 用于"从错题回顾里点『让 AI 讲讲这题』"——那时页面路由是 review，
   * 助手自己拿不到试卷 id，只能由调用方带过来。
   */
  const sendText = (raw: string, paperIdOverride?: string): void => {
    const text = raw.trim()
    if (!text || busy) return

    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }))
    const requestContext = paperIdOverride ? { ...context, paperId: paperIdOverride } : context

    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    setError(null)

    const handle = (event: AssistantEvent): void => {
      switch (event.type) {
        case 'assistant.delta':
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last) next[next.length - 1] = { ...last, content: last.content + event.text }
            return next
          })
          break
        case 'action.start':
          patchLast({ note: `正在按你的要求改第 ${event.action.index} 题…`, tone: 'busy' })
          break
        case 'action.done':
          patchLast({ note: event.summary, tone: 'ok' })
          window.dispatchEvent(
            new CustomEvent('mujuan:paper-updated', {
              detail: { paperId: context.paperId, questionId: event.questionId },
            }),
          )
          break
        case 'action.failed':
          patchLast({ note: `改题失败：${event.message}`, tone: 'err' })
          break
        case 'error':
          setError(event.message)
          setBusy(false)
          break
        case 'done':
          setBusy(false)
          break
        default:
          break
      }
    }

    abortRef.current = streamAssistant(
      role === 'teacher' ? '/api/assistant/chat' : '/api/student/assistant',
      {
        messages: [...history, { role: 'user', content: text }],
        context: requestContext,
      },
      handle,
      (message) => {
        setError(message)
        setBusy(false)
      },
    )
  }

  // 其他页面（如错题回顾）可以广播这个事件，让助手直接开口回答某个问题
  sendRef.current = sendText

  if (!open) {
    return (
      <button
        className="assistant-fab"
        style={
          fab.pos
            ? { left: fab.pos.x, top: fab.pos.y, right: 'auto', bottom: 'auto' }
            : undefined
        }
        title="打开命题助手（可拖动）"
        {...fab.handlers}
        onClick={() => {
          // 拖动结束时浏览器仍会补一个 click，靠 consumeDrag 挡掉
          if (!fab.consumeDrag()) setOpen(true)
        }}
      >
        <span>问</span>
        <em>助手</em>
      </button>
    )
  }

  const panelStyle = panel.pos
    ? { left: panel.pos.x, top: panel.pos.y, transform: 'none' }
    : undefined

  return (
    <section
      className={`assistant-panel${panel.pos ? ' pinned' : ' centered'}${panel.dragging ? ' dragging' : ''}`}
      style={panelStyle}
    >
      <header
        className="assistant-head"
        {...panel.handlers}
        onDoubleClick={panel.reset}
        title="按住可拖动，双击复位到屏幕中央"
      >
        <div>
          <strong>命题助手</strong>
          <span className="assistant-context">
            {overridePaperId || context.paperId ? '已读到当前试卷' : '未打开试卷'}
          </span>
        </div>
        <div className="assistant-head-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn btn-sm btn-ghost" onClick={panel.reset} title="复位到屏幕中央">
            居中
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)} title="收起为小浮球">
            收起
          </button>
        </div>
      </header>

      <div className="assistant-list" ref={listRef}>
        {messages.map((message, index) => (
          <div key={index} className={`assistant-msg ${message.role}`}>
            {message.content ? (
              <RichText text={message.content} />
            ) : (
              <span className="assistant-typing">
                <i />
                <i />
                <i />
              </span>
            )}
            {message.note && <div className={`assistant-note ${message.tone ?? ''}`}>{message.note}</div>}
          </div>
        ))}
        {error && <div className="assistant-note err">{error}</div>}
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          placeholder={PLACEHOLDER[role]}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendText(input)
            }
          }}
          rows={2}
        />
        <button className="btn btn-sm btn-seal" onClick={() => sendText(input)} disabled={busy || !input.trim()}>
          {busy ? '…' : '发送'}
        </button>
      </div>
    </section>
  )
}
