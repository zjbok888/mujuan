import { useEffect, useRef, useState } from 'react'
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

const GREETING: Message = {
  role: 'assistant',
  content:
    '我是命题助手。可以问我怎么把大纲写得更可考，也可以直接让我动手——比如「把第 3 题改难一点」「第 5 题的解析写详细些」。',
}

/**
 * 全局 AI 助手：悬浮在右下角，知道自己当前在哪一页、哪份卷子。
 * 它不只是聊天——模型可以在回答末尾挂一个动作块，服务端会真的去改题。
 */
export function Assistant({ context }: { context: AssistantContext }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => abortRef.current?.(), [])

  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  const patchLast = (patch: Partial<Message>): void => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last) next[next.length - 1] = { ...last, ...patch }
      return next
    })
  }

  const send = (): void => {
    const text = input.trim()
    if (!text || busy) return

    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }))

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
      {
        messages: [...history, { role: 'user', content: text }],
        context,
      },
      handle,
      (message) => {
        setError(message)
        setBusy(false)
      },
    )
  }

  return (
    <>
      {!open && (
        <button className="assistant-fab" onClick={() => setOpen(true)} title="AI 命题助手">
          <span>问</span>
          <em>助手</em>
        </button>
      )}

      {open && (
        <section className="assistant-panel">
          <header className="assistant-head">
            <div>
              <strong>命题助手</strong>
              <span className="assistant-context">
                {context.paperId ? '已读到当前试卷' : '未打开试卷'}
              </span>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              收起
            </button>
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
                {message.note && (
                  <div className={`assistant-note ${message.tone ?? ''}`}>{message.note}</div>
                )}
              </div>
            ))}
            {error && <div className="assistant-note err">{error}</div>}
          </div>

          <div className="assistant-input">
            <textarea
              value={input}
              placeholder="比如：把第 3 题改难一点 / 这份卷子偏简单，怎么调？"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
            />
            <button className="btn btn-sm btn-seal" onClick={send} disabled={busy || !input.trim()}>
              {busy ? '…' : '发送'}
            </button>
          </div>
        </section>
      )}
    </>
  )
}
