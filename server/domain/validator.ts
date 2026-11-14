import type { PaperIR, Question } from '../../shared/ir.js'
import type { ValidationIssue } from '../../shared/events.js'

const round2 = (n: number) => Math.round(n * 100) / 100

interface Located {
  question: Question
  path: string
}

function locate(paper: PaperIR): Located[] {
  const out: Located[] = []
  paper.sections.forEach((section, si) => {
    section.questions.forEach((question, qi) => {
      out.push({ question, path: `sections[${si}].questions[${qi}]` })
    })
  })
  return out
}

/**
 * 业务规则校验 —— 这是"AI 无法绕过"的那一层。
 *
 * zod 只保证结构合法，这里保证"这份卷子能用"：
 * 分值自洽、答案落在选项内、题型与字段匹配、蓝图与实际一致、无重复题。
 */
export function validatePaper(paper: PaperIR): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const located = locate(paper)

  const scoreSum = round2(located.reduce((sum, item) => sum + item.question.score, 0))
  if (Math.abs(scoreSum - paper.totalScore) > 0.01) {
    push('TOTAL_SCORE_MISMATCH', 'totalScore', `各题分值合计 ${scoreSum}，与声明总分 ${paper.totalScore} 不一致`)
  }

  for (const { question: q, path } of located) {
    switch (q.type) {
      case 'single': {
        if (!q.options || q.options.length < 2) {
          push('OPTIONS_MISSING', `${path}.options`, '单选题至少需要 2 个选项')
        }
        if (q.answers.length !== 1) {
          push('ANSWER_COUNT_INVALID', `${path}.answers`, '单选题必须恰好 1 个答案')
        }
        const keys = new Set((q.options ?? []).map((o) => o.key))
        for (const answer of q.answers) {
          if (keys.size > 0 && !keys.has(answer)) {
            push('ANSWER_NOT_IN_OPTIONS', `${path}.answers`, `答案「${answer}」不在选项 ${[...keys].join('/')} 中`)
          }
        }
        break
      }
      case 'multiple': {
        if (!q.options || q.options.length < 3) {
          push('OPTIONS_MISSING', `${path}.options`, '多选题至少需要 3 个选项')
        }
        if (q.answers.length < 2) {
          push('ANSWER_COUNT_INVALID', `${path}.answers`, '多选题答案不得少于 2 项')
        }
        const keys = new Set((q.options ?? []).map((o) => o.key))
        for (const answer of q.answers) {
          if (keys.size > 0 && !keys.has(answer)) {
            push('ANSWER_NOT_IN_OPTIONS', `${path}.answers`, `答案「${answer}」不在选项中`)
          }
        }
        break
      }
      case 'blank': {
        if (q.options && q.options.length > 0) {
          push('OPTIONS_NOT_ALLOWED', `${path}.options`, '填空题不应带选项')
        }
        if (q.answers.length === 0) {
          push('ANSWER_COUNT_INVALID', `${path}.answers`, '填空题至少需要 1 个标准答案')
        }
        break
      }
      case 'short': {
        if (!q.keywordRubric || q.keywordRubric.length === 0) {
          push('RUBRIC_MISSING', `${path}.keywordRubric`, '简答题必须给出关键词评分细则')
          break
        }
        const rubricSum = round2(q.keywordRubric.reduce((sum, r) => sum + r.points, 0))
        if (Math.abs(rubricSum - q.score) > 0.01) {
          push('RUBRIC_POINTS_MISMATCH', `${path}.keywordRubric`, `细则分值合计 ${rubricSum}，与题目分值 ${q.score} 不一致`)
        }
        break
      }
    }

    const optionKeys = (q.options ?? []).map((o) => o.key)
    if (new Set(optionKeys).size !== optionKeys.length) {
      push('DUPLICATE_OPTION_KEY', `${path}.options`, '选项编号重复')
    }
    if (q.knowledgePoints.length === 0) {
      push('KNOWLEDGE_POINT_MISSING', `${path}.knowledgePoints`, '每道题必须标注至少 1 个知识点')
    }
  }

  for (const item of paper.blueprint.items) {
    const actual = located.filter((l) => l.question.type === item.type).length
    if (actual !== item.count) {
      push('BLUEPRINT_COUNT_MISMATCH', 'blueprint', `蓝图计划 ${item.type} ${item.count} 题，实际 ${actual} 题`)
    }
  }

  const seen = new Map<string, string>()
  for (const { question: q, path } of located) {
    const fingerprint = q.stem.replace(/\s+/g, '').slice(0, 40)
    const previous = seen.get(fingerprint)
    if (previous) {
      push('DUPLICATE_QUESTION', path, `题干与 ${previous} 高度重复`)
    } else {
      seen.set(fingerprint, path)
    }
  }

  return issues
}

/** 把校验问题压缩成给模型看的修复指令（控制 token，突出可行动信息） */
export function issuesToRepairBrief(issues: ValidationIssue[], limit = 12): string {
  return issues
    .slice(0, limit)
    .map((issue, index) => `${index + 1}. [${issue.code}] ${issue.path}：${issue.message}`)
    .join('\n')
}
