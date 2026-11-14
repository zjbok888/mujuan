import type { PaperIR } from '../../shared/ir.js'
import type { GradeResult } from './grader.js'

export interface AttemptLike {
  student: string
  score: number
  maxScore: number
  result: GradeResult
}

export interface KnowledgeStat {
  knowledgePoint: string
  asked: number
  awarded: number
  max: number
  accuracy: number
}

export interface PaperStats {
  submissions: number
  /** 平均得分率（0-100） */
  avgPercent: number
  /** 试卷满分（分值） */
  fullScore: number
  passRate: number
  distribution: Array<{ label: string; count: number }>
  knowledge: KnowledgeStat[]
  hardest: Array<{ questionId: string; stem: string; accuracy: number; asked: number }>
}

const BUCKETS = [
  { label: '0-59', min: 0, max: 60 },
  { label: '60-69', min: 60, max: 70 },
  { label: '70-79', min: 70, max: 80 },
  { label: '80-89', min: 80, max: 90 },
  { label: '90-100', min: 90, max: 101 },
]

/**
 * 学情统计：纯函数，输入试卷 + 提交记录，输出大盘。
 * 不查库、不调模型 —— 保证统计口径在任何驱动下都一致。
 */
export function computeStats(paper: PaperIR, attempts: AttemptLike[]): PaperStats {
  const questions = paper.sections.flatMap((s) => s.questions)
  const questionById = new Map(questions.map((q) => [q.id, q]))
  const totalMax = questions.reduce((sum, q) => sum + q.score, 0)
  const submissions = attempts.length

  const percents = attempts.map((a) => (a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0))
  const avgPercent = submissions === 0 ? 0 : percents.reduce((a, b) => a + b, 0) / submissions

  const distribution = BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: percents.filter((p) => p >= bucket.min && p < bucket.max).length,
  }))

  // 知识点聚合
  const kpMap = new Map<string, { asked: number; awarded: number; max: number }>()
  for (const attempt of attempts) {
    for (const result of attempt.result.results) {
      const question = questionById.get(result.questionId)
      if (!question) continue
      for (const kp of question.knowledgePoints) {
        const cell = kpMap.get(kp) ?? { asked: 0, awarded: 0, max: 0 }
        cell.asked += 1
        cell.awarded += result.awarded
        cell.max += result.max
        kpMap.set(kp, cell)
      }
    }
  }
  const knowledge: KnowledgeStat[] = [...kpMap.entries()]
    .map(([knowledgePoint, cell]) => ({
      knowledgePoint,
      asked: cell.asked,
      awarded: Math.round(cell.awarded * 100) / 100,
      max: Math.round(cell.max * 100) / 100,
      accuracy: cell.max > 0 ? Math.round((cell.awarded / cell.max) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)

  // 难题榜：错误率最高的题
  const hardest = questions
    .map((q) => {
      let asked = 0
      let awarded = 0
      for (const attempt of attempts) {
        const result = attempt.result.results.find((r) => r.questionId === q.id)
        if (!result) continue
        asked += 1
        awarded += result.awarded
      }
      const accuracy = asked > 0 && q.score > 0 ? Math.round((awarded / (asked * q.score)) * 1000) / 10 : 0
      return { questionId: q.id, stem: q.stem, accuracy, asked }
    })
    .filter((item) => item.asked > 0)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5)

  return {
    submissions,
    avgPercent: Math.round(avgPercent * 10) / 10,
    fullScore: Math.round(totalMax * 100) / 100,
    passRate: submissions === 0 ? 0 : Math.round((percents.filter((p) => p >= 60).length / submissions) * 1000) / 10,
    distribution,
    knowledge,
    hardest,
  }
}
