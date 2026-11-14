import type { AssistantChatInput, AssistantEvent, ReviseAction } from '../../shared/assistant.js'
import { reviseActionSchema } from '../../shared/assistant.js'
import type { PaperIR } from '../../shared/ir.js'
import { LlmError } from '../infra/llm.js'
import { buildAssistantMessages, buildStudentMessages } from '../prompts/assistant.js'
import type { PaperRepo } from '../infra/repo.js'
import type { LlmPort } from './generator.js'
import { rewriteQuestion } from './rewriter.js'
import { computeStats } from './stats.js'

const ACTION_OPEN = '<action'

export interface AssistantOptions {
  input: AssistantChatInput
  repo: PaperRepo
  llm: LlmPort
  emit: (event: AssistantEvent) => void
  signal?: AbortSignal
}

/**
 * 助手主流程：流式说话 → 从流尾解析动作 → 执行动作 → 回报结果。
 *
 * 流式过滤器的作用是把 <action>…</action> 从用户可见文本里摘掉：
 * 用户只该看到"我把第 3 题改难了一点"，而不是一段 JSON。
 */
export async function runAssistant(opts: AssistantOptions): Promise<void> {
  const { input, repo, llm, emit } = opts

  const record = input.context.paperId ? await repo.getPaper(input.context.paperId) : null
  const stats =
    record && input.context.page === 'stats'
      ? computeStats(
          record.ir,
          (await repo.listAttempts(record.id))
            .filter((a) => !a.preview)
            .map((a) => ({ student: a.student, score: a.score, maxScore: a.maxScore, result: a.result })),
        )
      : null

  const messages = buildAssistantMessages(
    { context: input.context, paper: record?.ir ?? null, stats },
    input.messages,
  )

  let buffer = ''
  let sent = 0

  const flush = (final: boolean): void => {
    const open = buffer.indexOf(ACTION_OPEN)
    let safeEnd: number
    if (open >= 0) {
      safeEnd = open
    } else if (final) {
      safeEnd = buffer.length
    } else {
      // 末尾可能是半个 "<action"，先扣住不发，免得用户看到半截标签
      const tailStart = Math.max(0, buffer.length - (ACTION_OPEN.length - 1))
      const tail = buffer.slice(tailStart)
      const lt = tail.indexOf('<')
      safeEnd = lt >= 0 ? tailStart + lt : buffer.length
    }
    if (safeEnd > sent) {
      emit({ type: 'assistant.delta', text: buffer.slice(sent, safeEnd) })
      sent = safeEnd
    }
  }

  const reply = await llm(messages, {
    json: false,
    signal: opts.signal,
    maxTokens: 2000,
    onContent: (delta) => {
      buffer += delta
      flush(false)
    },
  })

  // 有些实现最后一次回调不完整，用返回值兜底
  if (reply.length > buffer.length) {
    buffer += reply.slice(buffer.length)
  }
  flush(true)

  const match = /<action>([\s\S]*?)<\/action>/.exec(buffer)
  if (!match || !record) return

  let action: ReviseAction | null = null
  try {
    const parsed = reviseActionSchema.safeParse(JSON.parse(match[1] ?? '{}'))
    if (parsed.success) action = parsed.data
  } catch {
    action = null
  }
  if (!action) return

  emit({ type: 'action.start', action })

  try {
    const questions = record.ir.sections.flatMap((s) => s.questions)
    const target = questions[action.index - 1]
    if (!target) throw new Error(`试卷里没有第 ${action.index} 题`)

    const { question: rewritten, issues } = await rewriteQuestion({
      paper: record.ir,
      questionId: target.id,
      instruction: action.instruction,
      llm,
      signal: opts.signal,
    })

    await repo.updateQuestion(record.id, target.id, {
      stem: rewritten.stem,
      options: rewritten.options,
      answers: rewritten.answers,
      keywordRubric: rewritten.keywordRubric,
      difficulty: rewritten.difficulty,
      knowledgePoints: rewritten.knowledgePoints,
      explanation: rewritten.explanation,
    })

    const preview = rewritten.stem.replace(/\$/g, '').replace(/\s+/g, ' ').slice(0, 26)
    emit({
      type: 'action.done',
      action,
      questionId: target.id,
      summary:
        issues.length > 0
          ? `第 ${action.index} 题已改写：${preview}…（有 ${issues.length} 处提示，建议复核）`
          : `第 ${action.index} 题已改写：${preview}…`,
    })
  } catch (error) {
    const message = error instanceof LlmError ? error.message : (error as Error).message
    emit({ type: 'action.failed', action, message })
  }
}

/**
 * 学生端学习助手：只说话，不动手。
 *
 * 刻意不做动作解析——学生端本来就没有改卷能力，
 * 与其"解析后拒绝"，不如让这条路径根本不存在。
 */
export async function runStudentTutor(options: {
  paper: PaperIR | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  llm: LlmPort
  emit: (event: AssistantEvent) => void
  signal?: AbortSignal
}): Promise<void> {
  const messages = buildStudentMessages(options.paper, options.history)

  await options.llm(messages, {
    json: false,
    signal: options.signal,
    maxTokens: 1500,
    onContent: (delta) => options.emit({ type: 'assistant.delta', text: delta }),
  })
}
