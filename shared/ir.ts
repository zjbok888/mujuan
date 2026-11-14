/**
 * QuizIR v1 — 墨卷的核心数据契约。
 *
 * 设计要点：AI 只被允许产出这一份"中间表示"，绝不产出页面代码或可执行逻辑。
 * 结构由 zod 在服务端强制校验，再由确定性渲染器执行。
 * 前后端共用本文件，是唯一真源（single source of truth）。
 */
import { z } from 'zod'

export const QUESTION_TYPE_LABEL = {
  single: '单选题',
  multiple: '多选题',
  blank: '填空题',
  short: '简答题',
} as const

export const questionTypeSchema = z.enum(['single', 'multiple', 'blank', 'short'])
export type QuestionType = z.infer<typeof questionTypeSchema>

export const DIFFICULTY_LABEL = {
  1: '识记',
  2: '理解',
  3: '应用',
  4: '分析',
  5: '综合',
} as const

const optionSchema = z.object({
  key: z.string().min(1).max(2),
  text: z.string().min(1).max(600),
})

export const questionSchema = z.object({
  id: z.string().min(1).max(64),
  type: questionTypeSchema,
  stem: z.string().min(1).max(2000),
  options: z.array(optionSchema).max(8).optional(),
  answers: z.array(z.string().min(1).max(2000)).min(1).max(8),
  keywordRubric: z
    .array(
      z.object({
        keyword: z.string().min(1).max(60),
        points: z.number().min(0).max(100),
      }),
    )
    .max(20)
    .optional(),
  score: z.number().positive().max(100),
  difficulty: z.number().int().min(1).max(5),
  knowledgePoints: z.array(z.string().min(1).max(40)).min(1).max(6),
  explanation: z.string().max(2000).default(''),
  status: z.enum(['ai', 'verified', 'needs-review', 'edited']).default('ai'),
})

export type Question = z.infer<typeof questionSchema>

export const sectionSchema = z.object({
  title: z.string().min(1).max(120),
  questions: z.array(questionSchema).min(1).max(50),
})

export type Section = z.infer<typeof sectionSchema>

export const blueprintSchema = z.object({
  items: z
    .array(
      z.object({
        type: questionTypeSchema,
        count: z.number().int().min(1).max(30),
      }),
    )
    .min(1)
    .max(6),
  coverage: z.array(z.string().min(1).max(40)).min(1).max(12),
  difficulty: z.object({
    d1: z.number().int().min(0),
    d2: z.number().int().min(0),
    d3: z.number().int().min(0),
    d4: z.number().int().min(0),
    d5: z.number().int().min(0),
  }),
  rationale: z.string().max(1200).default(''),
})

export type Blueprint = z.infer<typeof blueprintSchema>

export const paperSchema = z.object({
  schema: z.literal('quizir/v1'),
  title: z.string().min(1).max(120),
  subject: z.string().min(1).max(40),
  grade: z.string().min(1).max(40),
  totalScore: z.number().positive().max(300),
  durationMin: z.number().int().min(5).max(300),
  blueprint: blueprintSchema,
  sections: z.array(sectionSchema).min(1).max(8),
  meta: z.object({
    model: z.string().min(1).max(80),
    promptVersion: z.string().min(1).max(40),
    generatedAt: z.string().min(1).max(40),
  }),
})

export type PaperIR = z.infer<typeof paperSchema>

/** 生成请求的公开契约 */
export const generateRequestSchema = z.object({
  outline: z.string().min(8).max(4000),
  subject: z.string().min(1).max(40).default('综合'),
  grade: z.string().min(1).max(40).default('高二'),
  totalScore: z.number().int().min(10).max(150).default(100),
  durationMin: z.number().int().min(10).max(180).default(45),
  mix: z
    .array(
      z.object({
        type: questionTypeSchema,
        count: z.number().int().min(1).max(30),
      }),
    )
    .min(1)
    .max(4)
    .default([
      { type: 'single', count: 4 },
      { type: 'blank', count: 2 },
      { type: 'short', count: 1 },
    ]),
})

export type GenerateRequest = z.infer<typeof generateRequestSchema>

export const DEFAULT_GENERATE_REQUEST: GenerateRequest = {
  outline: '',
  subject: '数学',
  grade: '高二',
  totalScore: 100,
  durationMin: 45,
  mix: [
    { type: 'single', count: 4 },
    { type: 'blank', count: 2 },
    { type: 'short', count: 1 },
  ],
}

/** 试卷的派生统计：题目总数、题型分布 */
export function paperStats(paper: PaperIR) {
  const questions = paper.sections.flatMap((s) => s.questions)
  const byType = { single: 0, multiple: 0, blank: 0, short: 0 }
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const q of questions) {
    byType[q.type] += 1
    byDifficulty[q.difficulty as 1 | 2 | 3 | 4 | 5] += 1
  }
  return {
    count: questions.length,
    scoreSum: questions.reduce((a, q) => a + q.score, 0),
    byType,
    byDifficulty,
    knowledgePoints: [...new Set(questions.flatMap((q) => q.knowledgePoints))],
  }
}
