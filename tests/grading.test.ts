import { describe, expect, it } from 'vitest'
import { answersEqual, containsKeyword, normalizeAnswer } from '../server/domain/normalizer.js'
import { gradeQuestion, gradePaper } from '../server/domain/grader.js'
import type { PaperIR, Question } from '../shared/ir.js'

const q = (patch: Partial<Question>): Question => ({
  id: 'q_1',
  type: 'single',
  stem: 'stem',
  answers: ['A'],
  score: 5,
  difficulty: 3,
  knowledgePoints: ['kp'],
  explanation: '',
  status: 'ai',
  ...patch,
})

describe('答案归一化', () => {
  it('全角转半角、去空格、大小写不敏感', () => {
    expect(normalizeAnswer(' Ｘ ＝ １ ')).toBe('x=1')
    expect(normalizeAnswer('Ａ')).toBe('a')
  })

  it('容忍末尾标点与负号变体', () => {
    expect(answersEqual('-1。', '-1')).toBe(true)
    expect(answersEqual('−1', '-1')).toBe(true)
  })

  it('数值按容差比较', () => {
    expect(answersEqual('0.3333333', '0.3333334')).toBe(true)
    expect(answersEqual('2', '3')).toBe(false)
  })

  it('空答案不算命中', () => {
    expect(answersEqual('', '')).toBe(false)
  })

  it('关键词命中要求字面包含', () => {
    expect(containsKeyword('函数的极大值为 5/6', '极大值')).toBe(true)
    expect(containsKeyword('函数的极大值为 5/6', '极小值')).toBe(false)
  })
})

describe('确定性评分', () => {
  it('单选题全对得分、错选零分', () => {
    const question = q({})
    expect(gradeQuestion(question, ['A']).awarded).toBe(5)
    expect(gradeQuestion(question, ['B']).awarded).toBe(0)
  })

  it('多选题全对得分，漏选不给分', () => {
    const question = q({ id: 'q_m', type: 'multiple', answers: ['A', 'C'], score: 6 })
    expect(gradeQuestion(question, ['C', 'A']).awarded).toBe(6)
    expect(gradeQuestion(question, ['A']).awarded).toBe(0)
  })

  it('填空题按空计分，可拿部分分', () => {
    const question = q({ id: 'q_b', type: 'blank', answers: ['1', '2'], score: 4 })
    const result = gradeQuestion(question, ['1', '3'])
    expect(result.awarded).toBe(2)
    expect(result.verdict).toBe('partial')
  })

  it('简答题按关键词细则累加，且始终进入复核队列', () => {
    const question = q({
      id: 'q_s',
      type: 'short',
      answers: ['极大值为 2，单调递增区间为 (1,+∞)'],
      score: 10,
      keywordRubric: [
        { keyword: '极大值', points: 4 },
        { keyword: '单调递增', points: 6 },
      ],
    })
    expect(gradeQuestion(question, ['极大值 2，单调递增']).awarded).toBe(10)
    expect(gradeQuestion(question, ['极大值 2']).awarded).toBe(4)
  })

  it('同一份卷子重复评分结果完全一致', () => {
    const paper: PaperIR = {
      schema: 'quizir/v1',
      title: 't',
      subject: '数学',
      grade: '高二',
      totalScore: 10,
      durationMin: 20,
      blueprint: {
        items: [{ type: 'single', count: 2 }],
        coverage: ['kp'],
        difficulty: { d1: 0, d2: 0, d3: 2, d4: 0, d5: 0 },
        rationale: '',
      },
      sections: [{ title: '一', questions: [q({ id: 'a' }), q({ id: 'b' })] }],
      meta: { model: 'm', promptVersion: 'v1', generatedAt: 'now' },
    }
    const answers = { a: ['A'], b: ['B'] }
    const first = gradePaper(paper, answers)
    const second = gradePaper(paper, answers)
    expect(first).toEqual(second)
    expect(first.score).toBe(5)
    expect(first.maxScore).toBe(10)
  })
})
