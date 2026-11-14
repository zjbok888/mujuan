import { describe, expect, it } from 'vitest'
import { allocateScores } from '../server/domain/scoring.js'
import { computeStats } from '../server/domain/stats.js'
import type { PaperIR } from '../shared/ir.js'
import type { GradeResult } from '../shared/grading.js'

describe('分值分配', () => {
  it('合计精确等于总分', () => {
    for (const total of [10, 45, 100, 120, 150]) {
      const scores = allocateScores(['single', 'single', 'blank', 'short'], total)
      expect(scores.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('每题至少 1 分', () => {
    const scores = allocateScores(['single', 'single', 'single', 'single', 'short'], 12)
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(1)
  })

  it('简答题权重高于单选题', () => {
    const scores = allocateScores(['single', 'single', 'short'], 100)
    const single = scores[0] ?? 0
    const short = scores[2] ?? 0
    expect(short).toBeGreaterThan(single)
  })

  it('题量为 0 时返回空数组', () => {
    expect(allocateScores([], 100)).toEqual([])
  })
})

describe('学情聚合', () => {
  const paper: PaperIR = {
    schema: 'quizir/v1',
    title: 't',
    subject: '数学',
    grade: '高二',
    totalScore: 10,
    durationMin: 20,
    blueprint: {
      items: [{ type: 'single', count: 2 }],
      coverage: ['导数'],
      difficulty: { d1: 0, d2: 2, d3: 0, d4: 0, d5: 0 },
      rationale: '',
    },
    sections: [
      {
        title: '一',
        questions: [
          {
            id: 'q_1',
            type: 'single',
            stem: 'easy',
            options: [
              { key: 'A', text: '1' },
              { key: 'B', text: '2' },
            ],
            answers: ['A'],
            score: 5,
            difficulty: 2,
            knowledgePoints: ['导数'],
            explanation: '',
            status: 'ai',
          },
          {
            id: 'q_2',
            type: 'single',
            stem: 'hard',
            options: [
              { key: 'A', text: '1' },
              { key: 'B', text: '2' },
            ],
            answers: ['A'],
            score: 5,
            difficulty: 4,
            knowledgePoints: ['极值'],
            explanation: '',
            status: 'ai',
          },
        ],
      },
    ],
    meta: { model: 'm', promptVersion: 'v1', generatedAt: 'now' },
  }

  const attempt = (results: GradeResult['results']): { result: GradeResult; score: number; maxScore: number; student: string } => {
    const score = results.reduce((sum, r) => sum + r.awarded, 0)
    return {
      student: 's',
      score,
      maxScore: 10,
      result: { score, maxScore: 10, results, needsReview: [] },
    }
  }

  const full = attempt([
    { questionId: 'q_1', awarded: 5, max: 5, verdict: 'correct', detail: '' },
    { questionId: 'q_2', awarded: 5, max: 5, verdict: 'correct', detail: '' },
  ])
  const half = attempt([
    { questionId: 'q_1', awarded: 5, max: 5, verdict: 'correct', detail: '' },
    { questionId: 'q_2', awarded: 0, max: 5, verdict: 'wrong', detail: '' },
  ])

  it('统计提交数、平均分与及格率', () => {
    const stats = computeStats(paper, [full, half])
    expect(stats.submissions).toBe(2)
    expect(stats.avgPercent).toBe(75)
    expect(stats.passRate).toBe(50)
    expect(stats.fullScore).toBe(10)
  })

  it('知识点正确率按得分率聚合，且最弱的排在最前', () => {
    const stats = computeStats(paper, [full, half])
    expect(stats.knowledge[0]?.knowledgePoint).toBe('极值')
    const kp = stats.knowledge.find((k) => k.knowledgePoint === '导数')
    expect(kp?.accuracy).toBe(100)
  })

  it('失分最多的题排在最前', () => {
    const stats = computeStats(paper, [full, half])
    expect(stats.hardest[0]?.questionId).toBe('q_2')
  })

  it('没有提交时不抛错', () => {
    const stats = computeStats(paper, [])
    expect(stats.submissions).toBe(0)
    expect(stats.avgPercent).toBe(0)
    expect(stats.knowledge).toEqual([])
  })
})
