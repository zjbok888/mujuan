import { describe, expect, it } from 'vitest'
import { paperSchema, questionSchema, paperStats } from '../shared/ir.js'

const baseQuestion = {
  id: 'q_1',
  type: 'single' as const,
  stem: '函数 $f(x)=x^2$ 在 $x=1$ 处的导数为（　）',
  options: [
    { key: 'A', text: '1' },
    { key: 'B', text: '2' },
  ],
  answers: ['B'],
  score: 5,
  difficulty: 2 as const,
  knowledgePoints: ['导数'],
  explanation: '',
}

describe('QuizIR 结构契约', () => {
  it('接受合法的单选题', () => {
    expect(questionSchema.safeParse(baseQuestion).success).toBe(true)
  })

  it('缺少年级/学科等必填字段的试卷应被拒绝', () => {
    const result = paperSchema.safeParse({
      schema: 'quizir/v1',
      title: '测试卷',
      totalScore: 100,
      durationMin: 45,
      sections: [],
      blueprint: { items: [], coverage: [], difficulty: {} },
      meta: {},
    })
    expect(result.success).toBe(false)
  })

  it('schema 版本号必须是 quizir/v1', () => {
    const wrong = paperSchema.safeParse({
      schema: 'quizir/v2',
      title: 'x',
    })
    expect(wrong.success).toBe(false)
  })

  it('paperStats 统计题型、总分与知识点', () => {
    const paper = paperSchema.parse({
      schema: 'quizir/v1',
      title: '单元测',
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
            { ...baseQuestion, id: 'q_1', score: 5 },
            { ...baseQuestion, id: 'q_2', score: 5, knowledgePoints: ['极值'] },
          ],
        },
      ],
      meta: { model: 'm', promptVersion: 'v1', generatedAt: '2026-01-01' },
    })
    const stats = paperStats(paper)
    expect(stats.count).toBe(2)
    expect(stats.scoreSum).toBe(10)
    expect(stats.byType.single).toBe(2)
    expect([...stats.knowledgePoints].sort()).toEqual([...['导数', '极值']].sort())
  })
})
