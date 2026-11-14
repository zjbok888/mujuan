import type { Blueprint, GenerateRequest, Question } from '@shared/ir.js'
import type { ServerEvent, ValidationIssue } from '@shared/events.js'
import { streamGenerate } from './api.js'

/**
 * 生成任务的状态托管在组件之外。
 *
 * 起因是一个真实投诉：出卷出到一半切到"卷库"，生成就断了。
 * 原因是状态与 AbortController 都活在 ComposePage 里，路由一变组件卸载、
 * useEffect 清理函数顺手把流 abort 掉。把任务提到模块级 store 后，
 * 页面只是"窗口"，关掉窗口不影响任务本身。
 */
export type GenerationPhase = 'idle' | 'running' | 'done' | 'error'

export interface GenerationState {
  phase: GenerationPhase
  thinking: string
  blueprint: Blueprint | null
  items: Array<Question | null>
  issues: ValidationIssue[] | null
  repair: string | null
  paperId: string | null
  error: string | null
  warning: string | null
  request: GenerateRequest | null
  startedAt: number | null
}

const INITIAL: GenerationState = {
  phase: 'idle',
  thinking: '',
  blueprint: null,
  items: [],
  issues: null,
  repair: null,
  paperId: null,
  error: null,
  warning: null,
  request: null,
  startedAt: null,
}

let state: GenerationState = INITIAL
const listeners = new Set<() => void>()
let abortCurrent: (() => void) | null = null

function emit(next: Partial<GenerationState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function handleEvent(event: ServerEvent): void {
  switch (event.type) {
    case 'reasoning.delta':
      emit({ thinking: (state.thinking + event.text).slice(-2000) })
      break
    case 'plan.done':
      emit({ blueprint: event.blueprint })
      break
    case 'item.done':
      emit({ items: state.items.map((q, i) => (i === event.index ? event.question : q)) })
      break
    case 'validate.report':
      emit({ issues: event.issues })
      break
    case 'repair.attempt':
      emit({ repair: `第 ${event.round}/${event.maxRounds} 轮修复：${event.reason}` })
      break
    case 'paper.done':
      emit({ paperId: event.paperId })
      break
    case 'error':
      if (event.code === 'PARTIAL') emit({ warning: event.message })
      else emit({ error: event.message })
      break
    case 'done':
      emit({ phase: state.error ? 'error' : 'done' })
      break
    default:
      break
  }
}

export const generation = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getSnapshot(): GenerationState {
    return state
  },

  start(request: GenerateRequest): void {
    abortCurrent?.()
    const total = request.mix.reduce((sum, item) => sum + item.count, 0)

    emit({
      ...INITIAL,
      phase: 'running',
      request,
      items: Array.from({ length: total }, () => null),
      startedAt: Date.now(),
    })

    abortCurrent = streamGenerate(
      request,
      (event) => {
        // 流结束就断开引用，避免下一次 start 重复 abort
        if (event.type === 'done') abortCurrent = null
        handleEvent(event)
      },
      (message) => {
        abortCurrent = null
        emit({ phase: 'error', error: message })
      },
    )
  },

  /** 用户主动取消（保留已完成的部分，回到 idle 之外的"可查看"状态） */
  cancel(): void {
    abortCurrent?.()
    abortCurrent = null
    emit({ phase: state.items.some(Boolean) ? 'done' : 'idle' })
  },

  reset(): void {
    abortCurrent?.()
    abortCurrent = null
    state = INITIAL
    for (const listener of listeners) listener()
  },
}

export function generationProgress(snapshot: GenerationState): { filled: number; total: number } {
  const total = snapshot.items.length
  const filled = snapshot.items.filter(Boolean).length
  return { filled, total }
}
