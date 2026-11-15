/**
 * AI 助手的会话契约。
 *
 * 设计取舍：助手用「流式文本 + 尾部动作块」而不是纯 JSON。
 * 纯 JSON 就没法边想边说，用户体验会退化成"转圈 5 秒再一次性蹦出全文"。
 * 动作块用 <action>{...}</action> 包裹，服务端在流里把它拦掉，只把话术推给前端。
 */
import { z } from 'zod'

export const assistantContextSchema = z.object({
  page: z.enum(['compose', 'library', 'paper', 'take', 'stats', 'settings', 'student', 'review', 'reviews', 'mistakes', 'members']).default('compose'),
  paperId: z.string().max(64).optional(),
  /** 用户当前正在看的那道题（1 起） */
  questionIndex: z.number().int().min(1).max(200).optional(),
})

export type AssistantContext = z.infer<typeof assistantContextSchema>

export const assistantChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
  context: assistantContextSchema.default({ page: 'compose' }),
})

export type AssistantChatInput = z.infer<typeof assistantChatSchema>

export const reviseActionSchema = z.object({
  type: z.literal('revise_question'),
  /** 题号，1 起 */
  index: z.number().int().min(1).max(200),
  instruction: z.string().min(2).max(300),
})

export type ReviseAction = z.infer<typeof reviseActionSchema>

export type AssistantEvent =
  | { type: 'assistant.delta'; text: string }
  | { type: 'action.start'; action: ReviseAction }
  | { type: 'action.done'; action: ReviseAction; questionId: string; summary: string }
  | { type: 'action.failed'; action: ReviseAction; message: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }

export function encodeAssistantSse(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
