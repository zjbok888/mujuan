/**
 * 评分结果契约：服务端评分、前端展示共用同一份类型。
 * 放在 shared 而不是 server，是因为"分数怎么算"必须双端可读，
 * 前端不能自己再猜一遍。
 */
export type Verdict = 'correct' | 'partial' | 'wrong'

export interface QuestionResult {
  questionId: string
  awarded: number
  max: number
  verdict: Verdict
  detail: string
}

export interface GradeResult {
  score: number
  maxScore: number
  results: QuestionResult[]
  /** 需要教师复核的题目（简答题始终进入复核队列） */
  needsReview: string[]
}
