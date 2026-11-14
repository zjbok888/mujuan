import type { PaperIR, Question } from '../../shared/ir.js'
import type { GradeResult, QuestionResult, Verdict } from '../../shared/grading.js'
import { answersEqual, containsKeyword } from './normalizer.js'

export type { GradeResult, QuestionResult, Verdict }

type AnswerMap = Record<string, string[]>

function gradeSingle(q: Question, got: string[]): QuestionResult {
  const expected = q.answers[0] ?? ''
  const actual = got[0] ?? ''
  const ok = answersEqual(actual, expected)
  return {
    questionId: q.id,
    awarded: ok ? q.score : 0,
    max: q.score,
    verdict: ok ? 'correct' : 'wrong',
    detail: ok ? '答案一致' : `你的答案：${actual || '（空）'}`,
  }
}

function gradeMultiple(q: Question, got: string[]): QuestionResult {
  const expected = new Set(q.answers.map((a) => a.trim().toUpperCase()))
  const actual = new Set(got.map((a) => a.trim().toUpperCase()).filter(Boolean))
  const same = expected.size === actual.size && [...expected].every((k) => actual.has(k))
  // 多选题采用全对给分：部分正确在真实考试中通常不给分，避免"蒙对得分"
  return {
    questionId: q.id,
    awarded: same ? q.score : 0,
    max: q.score,
    verdict: same ? 'correct' : 'wrong',
    detail: same ? '选项完全一致' : `你的选择：${[...actual].sort().join('') || '（空）'}`,
  }
}

function gradeBlank(q: Question, got: string[]): QuestionResult {
  const total = q.answers.length
  let hit = 0
  for (let i = 0; i < total; i += 1) {
    if (answersEqual(got[i] ?? '', q.answers[i] ?? '')) hit += 1
  }
  const awarded = total === 0 ? 0 : Math.round(((q.score * hit) / total) * 100) / 100
  const verdict: Verdict = hit === total ? 'correct' : hit === 0 ? 'wrong' : 'partial'
  return {
    questionId: q.id,
    awarded,
    max: q.score,
    verdict,
    detail: `${hit}/${total} 空正确`,
  }
}

function gradeShort(q: Question, got: string[]): QuestionResult {
  const text = got.join('\n')
  const rubric = q.keywordRubric ?? []
  if (rubric.length === 0) {
    return {
      questionId: q.id,
      awarded: 0,
      max: q.score,
      verdict: 'wrong',
      detail: '该题缺少评分细则，需教师复核',
    }
  }
  const raw = rubric.reduce((sum, item) => sum + (containsKeyword(text, item.keyword) ? item.points : 0), 0)
  const awarded = Math.min(q.score, Math.round(raw * 100) / 100)
  const verdict: Verdict =
    awarded >= q.score ? 'correct' : awarded <= 0 ? 'wrong' : 'partial'
  return {
    questionId: q.id,
    awarded,
    max: q.score,
    verdict,
    detail: `命中 ${rubric.filter((r) => containsKeyword(text, r.keyword)).length}/${rubric.length} 个要点（建议教师复核）`,
  }
}

export function gradeQuestion(q: Question, got: string[]): QuestionResult {
  switch (q.type) {
    case 'single':
      return gradeSingle(q, got)
    case 'multiple':
      return gradeMultiple(q, got)
    case 'blank':
      return gradeBlank(q, got)
    case 'short':
      return gradeShort(q, got)
  }
}

/**
 * 确定性评分：同样的试卷 + 同样的作答，必然得到同样的分数。
 * 这里不调用任何模型——这是"判分可复现"的论证基础。
 */
export function gradePaper(paper: PaperIR, answers: AnswerMap): GradeResult {
  const questions = paper.sections.flatMap((s) => s.questions)
  const results = questions.map((q) => gradeQuestion(q, answers[q.id] ?? []))
  const score = Math.round(results.reduce((sum, r) => sum + r.awarded, 0) * 100) / 100
  const maxScore = Math.round(results.reduce((sum, r) => sum + r.max, 0) * 100) / 100
  return {
    score,
    maxScore,
    results,
    needsReview: questions.filter((q) => q.type === 'short').map((q) => q.id),
  }
}
