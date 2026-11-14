import { describe, expect, it } from 'vitest'
import type { PaperIR, Question } from '../shared/ir.js'
import { validatePaper, issuesToRepairBrief } from '../server/domain/validator.js'

function makeQuestion(patch: Partial<Question> = {}): Question {
  return {
    id: 'q_1',
    type: 'single',
    stem: 'default stem',
    options: [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
    ],
    answers: ['A'],
    score: 10,
    difficulty: 2,
    knowledgePoints: ['kp'],
    explanation: '',
    status: 'ai',
    ...patch,
  }
}

function makePaper(questions: Question[], totalScore = 10): PaperIR {
  return {
    schema: 'quizir/v1',
    title: '试卷',
    subject: '数学',
    grade: '高二',
    totalScore,
    durationMin: 45,
    blueprint: {
      items: [{ type: 'single', count: questions.length }],
      coverage: ['kp'],
      difficulty: { d1: 0, d2: questions.length, d3: 0, d4: 0, d5: 0 },
      rationale: '',
    },
    sections: [{ title: '一', questions }],
    meta: { model: 'm', promptVersion: 'v1', generatedAt: 'now' },
  }
}

const codes = (paper: PaperIR) => validatePaper(paper).map((i) => i.code)

describe('业务规则校验', () => {
  it('一份自洽的卷子零问题', () => {
    expect(validatePaper(makePaper([makeQuestion()]))).toHaveLength(0)
  })

  it('分值合计与声明总分不符时报错', () => {
    expect(codes(makePaper([makeQuestion()], 100))).toContain('TOTAL_SCORE_MISMATCH')
  })

  it('答案不在选项内时报错', () => {
    expect(codes(makePaper([makeQuestion({ answers: ['Z'] })]))).toContain('ANSWER_NOT_IN_OPTIONS')
  })

  it('单选题给了两个答案时报错', () => {
    expect(codes(makePaper([makeQuestion({ answers: ['A', 'B'] })]))).toContain('ANSWER_COUNT_INVALID')
  })

  it('填空题携带选项时报错', () => {
    const question = makeQuestion({ type: 'blank', answers: ['1'], options: [{ key: 'A', text: 'x' }] })
    expect(codes(makePaper([question]))).toContain('OPTIONS_NOT_ALLOWED')
  })

  it('简答题细则分值之和必须等于题目分值', () => {
    const question = makeQuestion({
      type: 'short',
      options: undefined,
      answers: ['解答'],
      score: 10,
      keywordRubric: [{ keyword: '极大值', points: 3 }],
    })
    expect(codes(makePaper([question]))).toContain('RUBRIC_POINTS_MISMATCH')
  })

  it('简答题缺少细则时报错', () => {
    const question = makeQuestion({
      type: 'short',
      options: undefined,
      answers: ['解答'],
    })
    expect(codes(makePaper([question]))).toContain('RUBRIC_MISSING')
  })

  it('题干高度重复时报错', () => {
    const paper = makePaper(
      [makeQuestion({ id: 'q_1' }), makeQuestion({ id: 'q_2', score: 0.0001 })],
      10.0001,
    )
    expect(codes(paper)).toContain('DUPLICATE_QUESTION')
  })

  it('蓝图题量与实际不符时报错', () => {
    const paper = makePaper([makeQuestion()])
    paper.blueprint.items = [{ type: 'single', count: 3 }]
    expect(codes(paper)).toContain('BLUEPRINT_COUNT_MISMATCH')
  })

  it('修复指令会把问题压缩成可执行清单', () => {
    const brief = issuesToRepairBrief(validatePaper(makePaper([makeQuestion({ answers: ['Z'] })])))
    expect(brief).toContain('ANSWER_NOT_IN_OPTIONS')
    expect(brief.split('\n').length).toBeLessThanOrEqual(12)
  })
})
