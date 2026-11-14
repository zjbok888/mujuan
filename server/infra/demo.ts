import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PaperIR, Question, QuestionType } from '../../shared/ir.js'
import { paperSchema } from '../../shared/ir.js'
import type { LlmPort } from '../domain/generator.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const LABEL_TO_TYPE: Record<string, QuestionType> = {
  单选题: 'single',
  多选题: 'multiple',
  填空题: 'blank',
  简答题: 'short',
}

/**
 * 演示模式的"模型"：把一次真实生成的结果按原来的调用节奏回放出来。
 *
 * 它不是为了好看，而是为了满足最硬的那条验收标准：
 * 断网、无 Key、无预算的评委机器上，整条产品闭环依然可以完整演示。
 */
export function loadDemoPaper(): PaperIR {
  const file = resolve(process.cwd(), 'fixtures', 'demo-paper.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { paper?: PaperIR } | PaperIR
  const candidate = 'paper' in raw && raw.paper ? raw.paper : (raw as PaperIR)
  return paperSchema.parse(candidate)
}

/**
 * 演示模式的能力边界：内置样例每种题型各有多少题，就只能回放多少题。
 * 超出部分自动收窄，而不是生成一份自相矛盾（蓝图对不上）的卷子。
 */
export function clampMixToDemo(
  mix: Array<{ type: QuestionType; count: number }>,
  paper: PaperIR,
): Array<{ type: QuestionType; count: number }> {
  const available = new Map<QuestionType, number>()
  for (const question of paper.sections.flatMap((s) => s.questions)) {
    available.set(question.type, (available.get(question.type) ?? 0) + 1)
  }
  const clamped = mix
    .map((item) => ({ type: item.type, count: Math.min(item.count, available.get(item.type) ?? 0) }))
    .filter((item) => item.count > 0)
  return clamped.length > 0 ? clamped : [{ type: 'single', count: 1 }]
}

/** 分值被系统重新分配后，评分细则必须同步缩放，否则回放出来的卷子自己就不自洽 */
function rescale(points: number[], target: number): number[] {
  const sum = points.reduce((a, b) => a + b, 0)
  if (sum <= 0 || points.length === 0) return points
  const out = points.map((p) => Math.max(0, Math.round((p / sum) * target)))
  let diff = target - out.reduce((a, b) => a + b, 0)

  const order = out.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value)
  let cursor = 0
  while (diff !== 0 && order.length > 0 && cursor < 500) {
    const target0 = order[cursor % order.length]
    if (target0 && diff > 0) {
      out[target0.index] = (out[target0.index] ?? 0) + 1
      diff -= 1
    } else if (target0 && diff < 0 && (out[target0.index] ?? 0) > 0) {
      out[target0.index] = (out[target0.index] ?? 0) - 1
      diff += 1
    }
    cursor += 1
  }
  return out
}

export function createDemoPort(paper: PaperIR, stepMs = 16): LlmPort {
  // 按题型分队列：回放必须能应对评委随手改的题型配比，不能只会顺序取题
  const queues = new Map<QuestionType, Question[]>()
  for (const question of paper.sections.flatMap((s) => s.questions)) {
    const list = queues.get(question.type) ?? []
    list.push(question)
    queues.set(question.type, list)
  }

  return async (messages, options) => {
    const user = messages[1]?.content ?? ''
    // 按用户消息里的阶段特征识别，比匹配系统提示词措辞更稳（改文案不会打断回放）
    const planMode = user.includes('总题数：') && user.includes('题型配比：')
    const itemsMode = user.includes('本次需要命制的题位')
    const repairMode = user.includes('待修正试卷')

    const thinking = planMode
      ? ['先读大纲……', '识别出可考的核心概念……', '按识记/理解/应用拉开难度梯度……', '确定覆盖面与题量配比。']
      : itemsMode
        ? ['正在为题位设计题干……', '构造有区分度的干扰项……', '核对答案唯一性……', '补齐知识点标签。']
        : ['通读校验问题……', '定位到具体题位……', '只改问题点，不动分值。']

    for (const chunk of thinking) {
      for (const piece of chunk.match(/.{1,6}/g) ?? []) {
        if (options.signal?.aborted) return ''
        options.onReasoning?.(piece)
        await sleep(stepMs)
      }
      options.onReasoning?.('\n')
    }

    if (planMode) {
      await sleep(stepMs * 4)
      return JSON.stringify({
        title: paper.title,
        coverage: paper.blueprint.coverage,
        difficulty: paper.blueprint.difficulty,
        rationale: paper.blueprint.rationale,
      })
    }

    if (repairMode) {
      await sleep(stepMs * 4)
      return JSON.stringify(paper)
    }

    // 从题位清单里读出「题型 + 分值」，逐条回放对应题型的样例题
    const slots = [...user.matchAll(/题位\s*\d+｜([^｜]+)｜\s*([\d.]+)\s*分/g)].map((m) => ({
      type: LABEL_TO_TYPE[(m[1] ?? '').trim()],
      score: Number(m[2] ?? 0),
    }))

    const batch: Array<Record<string, unknown>> = []
    for (const slot of slots) {
      if (!slot.type) continue
      const queue = queues.get(slot.type) ?? []
      const source = queue.shift()
      if (!source) continue

      const rubric = source.keywordRubric
      const scaled =
        slot.type === 'short' && rubric && rubric.length > 0
          ? rescale(
              rubric.map((r) => r.points),
              slot.score,
            ).map((points, index) => ({ keyword: rubric[index]?.keyword ?? '', points }))
          : rubric

      batch.push({
        type: slot.type,
        stem: source.stem,
        options: source.options,
        answers: source.answers,
        keywordRubric: scaled,
        difficulty: source.difficulty,
        knowledgePoints: source.knowledgePoints,
        explanation: source.explanation,
      })
    }

    await sleep(stepMs * 6)
    return JSON.stringify({ questions: batch })
  }
}
