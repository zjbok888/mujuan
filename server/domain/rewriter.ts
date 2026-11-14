import { z } from 'zod'
import type { PaperIR, Question } from '../../shared/ir.js'
import { questionTypeSchema } from '../../shared/ir.js'
import type { ValidationIssue } from '../../shared/events.js'
import { extractJson, LlmError } from '../infra/llm.js'
import type { LlmPort } from './generator.js'
import { validatePaper } from './validator.js'

const draftSchema = z.object({
  stem: z.string().min(1).max(2000),
  options: z
    .array(z.object({ key: z.string().min(1).max(2), text: z.string().min(1).max(600) }))
    .optional(),
  answers: z.array(z.union([z.string(), z.number()])).min(1).max(8),
  keywordRubric: z
    .array(z.object({ keyword: z.string().min(1).max(60), points: z.number().min(0) }))
    .optional(),
  difficulty: z.number().min(1).max(5).optional(),
  knowledgePoints: z.array(z.string()).optional(),
  explanation: z.string().max(2000).optional(),
  type: questionTypeSchema.optional(),
})

const SYSTEM = `你是资深命题教师，负责按老师的要求重写**一道**题。
只输出一个 JSON 对象，不要解释、不要代码块。

字段：stem / options / answers / keywordRubric / difficulty / knowledgePoints / explanation

硬性约束：
1. 题型与分值由系统持有，你不得改动，也不要输出 type/score 字段；
2. 单选题 4 个选项，answers 恰好 1 项且在选项内；多选题 4 个选项，answers 2-3 项；
3. 填空题不出选项，answers 给最简标准答案；
4. 简答题必须给 keywordRubric，各条 points 之和等于该题分值，keyword 是答案里原样出现的 2-10 字片段；
5. 公式用 LaTeX，$...$ 包裹；
6. 不要与同一份试卷里的其他题目重复。`

export interface RewriteInput {
  paper: PaperIR
  questionId: string
  instruction: string
  llm: LlmPort
  signal?: AbortSignal
  onReasoning?: (delta: string) => void
}

export interface RewriteResult {
  question: Question
  issues: ValidationIssue[]
}

/**
 * 单题改写：守住不变量（id / 题型 / 分值），其余交给模型。
 * 校验只报告"这一题"的问题，避免被卷内其他历史问题干扰。
 */
export async function rewriteQuestion(input: RewriteInput): Promise<RewriteResult> {
  const questions = input.paper.sections.flatMap((s) => s.questions)
  const index = questions.findIndex((q) => q.id === input.questionId)
  if (index < 0) throw new LlmError('PARSE', '找不到要修改的题目')
  const current = questions[index] as Question

  const others = questions
    .filter((q) => q.id !== current.id)
    .map((q) => `- ${q.stem.replace(/\s+/g, ' ').slice(0, 40)}`)
    .slice(0, 10)

  const user = [
    `学科：${input.paper.subject}｜年级：${input.paper.grade}`,
    `知识点覆盖：${input.paper.blueprint.coverage.join('、')}`,
    '',
    '【原题】',
    JSON.stringify({
      type: current.type,
      score: current.score,
      stem: current.stem,
      options: current.options,
      answers: current.answers,
      keywordRubric: current.keywordRubric,
      difficulty: current.difficulty,
      knowledgePoints: current.knowledgePoints,
      explanation: current.explanation,
    }),
    '',
    `【老师的修改要求】${input.instruction}`,
    '',
    others.length > 0 ? `【同卷其他题，别重复】\n${others.join('\n')}` : '',
  ].join('\n')

  let draft: z.infer<typeof draftSchema> | null = null
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2 && !draft; attempt += 1) {
    try {
      const text = await input.llm(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        {
          json: true,
          signal: input.signal,
          onReasoning: input.onReasoning,
          // 推理模型的输出预算常被思考吃光，第二次直接翻倍
          maxTokens: attempt === 0 ? 8000 : 14000,
        },
      )
      draft = draftSchema.parse(extractJson(text))
    } catch (error) {
      lastError = error
      if (error instanceof LlmError && (error.code === 'ABORTED' || error.code === 'NO_KEY')) throw error
    }
  }

  if (!draft) {
    throw lastError instanceof LlmError ? lastError : new LlmError('PARSE', '改写结果解析失败')
  }
  const answers = draft.answers.map((a) => String(a).trim()).filter(Boolean)

  const rewritten: Question = {
    ...current,
    stem: draft.stem.trim(),
    options:
      current.type === 'single' || current.type === 'multiple'
        ? (draft.options ?? current.options ?? [])
        : undefined,
    answers: answers.length > 0 ? answers : current.answers,
    keywordRubric:
      current.type === 'short' ? (draft.keywordRubric ?? current.keywordRubric) : undefined,
    difficulty: draft.difficulty ? Math.min(5, Math.max(1, Math.round(draft.difficulty))) : current.difficulty,
    knowledgePoints:
      draft.knowledgePoints && draft.knowledgePoints.length > 0
        ? draft.knowledgePoints.slice(0, 4)
        : current.knowledgePoints,
    explanation: draft.explanation ?? current.explanation,
  }

  // 用整卷校验，但只挑出这一题的问题
  const cloned: PaperIR = {
    ...input.paper,
    sections: input.paper.sections.map((section) => ({
      ...section,
      questions: section.questions.map((q) => (q.id === current.id ? rewritten : q)),
    })),
  }
  const all = validatePaper(cloned)
  const scoped = all.filter((issue) => {
    const match = /sections\[(\d+)\]\.questions\[(\d+)\]/.exec(issue.path)
    if (!match) return false
    const si = Number(match[1])
    const qi = Number(match[2])
    const target = input.paper.sections[si]?.questions[qi]
    return target?.id === current.id
  })

  return { question: rewritten, issues: scoped }
}
