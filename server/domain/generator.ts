import { z } from 'zod'
import type { Blueprint, GenerateRequest, PaperIR, Question, QuestionType } from '../../shared/ir.js'
import { paperSchema, questionTypeSchema } from '../../shared/ir.js'
import type { ServerEvent, ValidationIssue } from '../../shared/events.js'
import { extractJson, LlmError, type ChatMessage } from '../infra/llm.js'
import {
  PROMPT_VERSION,
  buildItemsMessages,
  buildPlanMessages,
  buildRepairMessages,
  type SlotSpec,
} from '../prompts/index.js'
import { allocateScores } from './scoring.js'
import { issuesToRepairBrief, validatePaper } from './validator.js'

export type LlmPort = (
  messages: ChatMessage[],
  options: { json: boolean; onReasoning?: (delta: string) => void; signal?: AbortSignal; maxTokens?: number },
) => Promise<string>

export interface GenerateOptions {
  req: GenerateRequest
  llm: LlmPort
  emit: (event: ServerEvent) => void
  modelName: string
  signal?: AbortSignal
  maxRepairRounds?: number
  batchSize?: number
}

export interface GenerateResult {
  ir: PaperIR
  issues: ValidationIssue[]
  repairs: number
}

const planResponseSchema = z.object({
  title: z.string().min(2).max(60),
  coverage: z.array(z.string().min(1).max(40)).min(1).max(12),
  difficulty: z
    .object({
      d1: z.number().int().min(0),
      d2: z.number().int().min(0),
      d3: z.number().int().min(0),
      d4: z.number().int().min(0),
      d5: z.number().int().min(0),
    })
    .default({ d1: 0, d2: 0, d3: 0, d4: 0, d5: 0 }),
  rationale: z.string().max(1200).default(''),
})

/**
 * 模型输出的"草稿题"。
 *
 * 这里刻意放宽类型（answers 允许数字、字段允许缺失），
 * 因为真实模型经常把 "2" 写成 2、把 options 漏掉。
 * 放宽解析 + 收紧入库，比要求模型完美更可靠。
 */
const draftQuestionSchema = z.object({
  type: questionTypeSchema.optional(),
  stem: z.string().min(1).max(2000),
  options: z
    .array(z.object({ key: z.string().min(1).max(2), text: z.string().min(1).max(600) }))
    .optional(),
  answers: z.array(z.union([z.string(), z.number()])).optional(),
  keywordRubric: z
    .array(z.object({ keyword: z.string().min(1).max(60), points: z.number().min(0) }))
    .optional(),
  difficulty: z.number().optional(),
  knowledgePoints: z.array(z.string()).optional(),
  explanation: z.string().optional(),
})

const itemsResponseSchema = z.object({
  questions: z.array(draftQuestionSchema).min(1),
})

/**
 * 分批策略：简答题单独成批。
 *
 * 起因是一次真实故障——简答题 + 十几条评分细则一次生成时，
 * 推理模型把输出预算全花在思考上，content 直接为空，整卷失败。
 * 把简答题拆成单题批次后，单次输出规模可控，故障率显著下降。
 */
function makeBatches(slots: SlotSpec[], size: number): SlotSpec[][] {
  const out: SlotSpec[][] = []
  let buffer: SlotSpec[] = []
  for (const slot of slots) {
    if (slot.type === 'short') {
      if (buffer.length > 0) {
        out.push(buffer)
        buffer = []
      }
      out.push([slot])
      continue
    }
    buffer.push(slot)
    if (buffer.length >= size) {
      out.push(buffer)
      buffer = []
    }
  }
  if (buffer.length > 0) out.push(buffer)
  return out
}

function toQuestion(raw: z.infer<typeof draftQuestionSchema>, slot: SlotSpec, id: string): Question {
  const answers = (raw.answers ?? []).map((a) => String(a).trim()).filter(Boolean)
  const rubric =
    raw.keywordRubric && raw.keywordRubric.length > 0
      ? raw.keywordRubric.map((r) => ({ keyword: r.keyword, points: r.points }))
      : undefined

  // 简答题细则必须与分值自洽，否则交给校验器而不是在这里静默改分
  return {
    id,
    type: slot.type,
    stem: raw.stem.trim(),
    ...(slot.type === 'single' || slot.type === 'multiple' ? { options: raw.options ?? [] } : {}),
    answers: answers.length > 0 ? answers : ['（缺答案）'],
    ...(slot.type === 'short' ? { keywordRubric: rubric ?? [] } : {}),
    score: slot.score,
    difficulty: Math.min(5, Math.max(1, Math.round(raw.difficulty ?? 3))),
    knowledgePoints: (raw.knowledgePoints ?? []).filter(Boolean).slice(0, 4),
    explanation: raw.explanation ?? '',
    status: 'ai',
  }
}

/** 把校验问题路径映射回题目，用于标记 needs-review */
function markNeedsReview(ir: PaperIR, issues: ValidationIssue[]): void {
  for (const issue of issues) {
    const match = /sections\[(\d+)\]\.questions\[(\d+)\]/.exec(issue.path)
    if (!match) continue
    const si = Number(match[1])
    const qi = Number(match[2])
    const question = ir.sections[si]?.questions[qi]
    if (question && question.status !== 'edited') question.status = 'needs-review'
  }
}

export async function generatePaper(options: GenerateOptions): Promise<GenerateResult> {
  const { req, llm, emit, modelName, signal } = options
  const maxRepairRounds = options.maxRepairRounds ?? 2
  const batchSize = options.batchSize ?? 2

  const total = req.mix.reduce((sum, item) => sum + item.count, 0)
  if (total <= 0) throw new LlmError('PARSE', '题型配比为空')

  const reason = (delta: string) => emit({ type: 'reasoning.delta', text: delta })

  // ── 阶段一：命题蓝图 ────────────────────────────────────────────────
  const planText = await llm(buildPlanMessages(req, total), {
    json: true,
    signal,
    onReasoning: reason,
    maxTokens: 6000,
  })
  const plan = planResponseSchema.parse(extractJson(planText))

  const blueprint: Blueprint = {
    items: req.mix.map((item) => ({ type: item.type, count: item.count })),
    coverage: plan.coverage.slice(0, 12),
    difficulty: plan.difficulty,
    rationale: plan.rationale,
  }
  emit({ type: 'plan.done', blueprint })

  // ── 阶段二：按题位分批命题 ──────────────────────────────────────────
  const slots: SlotSpec[] = []
  for (const item of req.mix) {
    for (let i = 0; i < item.count; i += 1) {
      slots.push({ index: slots.length, type: item.type as QuestionType, score: 0 })
    }
  }
  const scores = allocateScores(
    slots.map((s) => s.type),
    req.totalScore,
  )
  slots.forEach((slot, i) => {
    slot.score = scores[i] ?? 1
  })

  const questions: Question[] = []
  const usedStems: string[] = []
  const batches = makeBatches(slots, batchSize)
  // 两路并发：单批约 15s，串行 7 题要 60s+，并发后压到 30s 内，且失败只影响单批
  const CONCURRENCY = Math.min(2, batches.length)
  let cursor = 0

  const runBatch = async (batch: SlotSpec[]): Promise<Question[]> => {
    batch.forEach((slot) => {
      emit({ type: 'item.start', index: slot.index, total: slots.length, questionType: slot.type })
    })

    const messages = buildItemsMessages(req, blueprint, batch, [...usedStems])
    let parsed: z.infer<typeof itemsResponseSchema> | null = null
    let lastError: unknown = null

    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        // 第二次尝试直接给更大的输出预算：空响应的主因就是推理吃光了额度
        const text = await llm(messages, {
          json: true,
          signal,
          onReasoning: reason,
          maxTokens: attempt === 0 ? 8000 : 12000,
        })
        parsed = itemsResponseSchema.parse(extractJson(text))
      } catch (error) {
        lastError = error
        if (error instanceof LlmError && (error.code === 'ABORTED' || error.code === 'NO_KEY')) throw error
      }
    }
    if (!parsed) {
      throw lastError instanceof LlmError
        ? lastError
        : new LlmError('PARSE', `第 ${(batch[0]?.index ?? 0) + 1} 组题目解析失败`)
    }

    const data = parsed
    const produced: Question[] = []
    batch.forEach((slot, offset) => {
      const raw = data.questions[offset]
      if (!raw) return
      const question = toQuestion(raw, slot, `q_${slot.index + 1}`)
      produced.push(question)
      usedStems.push(question.stem.replace(/\s+/g, ' ').slice(0, 40))
      emit({ type: 'item.done', index: slot.index, question })
    })
    return produced
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        const batch = batches[index]
        if (!batch) return
        const produced = await runBatch(batch)
        questions.push(...produced)
      }
    }),
  )

  // 并发完成顺序不确定，装配前按题位回正
  questions.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))

  // ── 阶段三：装配并按业务规则校验 ────────────────────────────────────
  const ir: PaperIR = {
    schema: 'quizir/v1',
    title: plan.title,
    subject: req.subject,
    grade: req.grade,
    totalScore: req.totalScore,
    durationMin: req.durationMin,
    blueprint,
    sections: [{ title: '一、试题', questions }],
    meta: {
      model: modelName,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    },
  }

  let issues = validatePaper(ir)
  emit({ type: 'validate.report', ok: issues.length === 0, issues })

  // ── 阶段四：把结构化问题回喂模型修复（上限 2 轮）────────────────────
  let repairs = 0
  while (issues.length > 0 && repairs < maxRepairRounds) {
    repairs += 1
    emit({
      type: 'repair.attempt',
      round: repairs,
      maxRounds: maxRepairRounds,
      reason: issues[0]?.message ?? '校验未通过',
    })

    try {
      const text = await llm(buildRepairMessages(ir, issuesToRepairBrief(issues)), {
        json: true,
        signal,
        onReasoning: reason,
        maxTokens: 14000,
      })
      const repaired = paperSchema.safeParse(extractJson(text))
      if (!repaired.success) break

      const repairedQuestions = repaired.data.sections.flatMap((s) => s.questions)
      const original = ir.sections.flatMap((s) => s.questions)
      if (repairedQuestions.length !== original.length) break

      // 只接受"内容修正"：id / type / score 由系统持有，模型改不动
      original.forEach((question, index) => {
        const incoming = repairedQuestions[index]
        if (!incoming) return
        question.stem = incoming.stem
        question.options = incoming.options ?? question.options
        question.answers = incoming.answers.length > 0 ? incoming.answers : question.answers
        if (question.type === 'short') {
          question.keywordRubric = incoming.keywordRubric ?? question.keywordRubric
        }
        question.difficulty = incoming.difficulty
        question.knowledgePoints =
          incoming.knowledgePoints.length > 0 ? incoming.knowledgePoints : question.knowledgePoints
        question.explanation = incoming.explanation
      })
    } catch (error) {
      if (error instanceof LlmError && (error.code === 'ABORTED' || error.code === 'NO_KEY')) throw error
      break
    }

    issues = validatePaper(ir)
    emit({ type: 'validate.report', ok: issues.length === 0, issues })
  }

  if (issues.length > 0) markNeedsReview(ir, issues)

  return { ir, issues, repairs }
}
