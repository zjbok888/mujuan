/**
 * 生成过程的 SSE 事件契约 —— 前端状态机的唯一输入。
 *
 * 约束：
 * 1. 每个流必须以 `done` 或 `error` 收尾，禁止让前端永久转圈；
 * 2. 事件只描述事实，不携带任何密钥或原始提示词；
 * 3. `reasoning.delta` 用于"思考可视化"，只展示模型自述的推理片段。
 */
import type { Blueprint, PaperIR, Question, QuestionType } from './ir.js'

export type ValidationIssue = {
  code: string
  path: string
  message: string
}

export type ServerEvent =
  | { type: 'reasoning.delta'; text: string }
  | { type: 'plan.delta'; text: string }
  | { type: 'plan.done'; blueprint: Blueprint }
  | { type: 'item.start'; index: number; total: number; questionType: QuestionType }
  | { type: 'item.done'; index: number; question: Question }
  | { type: 'validate.report'; ok: boolean; issues: ValidationIssue[] }
  | { type: 'repair.attempt'; round: number; maxRounds: number; reason: string }
  | { type: 'paper.done'; paperId: string; paper: PaperIR }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

/** 单条 SSE 帧的编码：event 与 data 同时给出，便于 EventSource 分派 */
export function encodeSse(event: ServerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
