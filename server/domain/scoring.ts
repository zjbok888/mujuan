import type { QuestionType } from '../../shared/ir.js'

/**
 * 分值分配：由系统确定性计算，模型无权决定。
 *
 * 这是"约束 AI"最划算的一刀——如果让模型自己分值，它会经常给出
 * 合计 97 分、或者单选 3 分多选 12 分这类无法自洽的结果，
 * 每一份卷子都要走一轮修复。把分值收归系统后，这类校验问题从源头消失。
 */
const WEIGHT: Record<QuestionType, number> = {
  single: 1,
  multiple: 1.6,
  blank: 1.3,
  short: 4,
}

export function allocateScores(types: QuestionType[], totalScore: number): number[] {
  if (types.length === 0) return []
  const raw = types.map((type) => WEIGHT[type])
  const weightSum = raw.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) return types.map(() => 1)

  const exact = raw.map((w) => (w / weightSum) * totalScore)
  const scores = exact.map((v) => Math.max(1, Math.floor(v)))

  // 最大余数法：把差额逐个补给小数部分最大的题位，保证合计精确等于总分
  let diff = totalScore - scores.reduce((a, b) => a + b, 0)
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  let cursor = 0
  while (diff > 0 && byFraction.length > 0) {
    const target = byFraction[cursor % byFraction.length]
    if (target) scores[target.index] = (scores[target.index] ?? 1) + 1
    diff -= 1
    cursor += 1
  }
  while (diff < 0) {
    // 从分值最高的题位开始回收，但不允许低于 1 分
    let picked = -1
    for (let i = 0; i < scores.length; i += 1) {
      if ((scores[i] ?? 0) > 1 && (picked === -1 || (scores[i] ?? 0) > (scores[picked] ?? 0))) picked = i
    }
    if (picked === -1) break
    scores[picked] = (scores[picked] ?? 1) - 1
    diff += 1
  }

  return scores
}
