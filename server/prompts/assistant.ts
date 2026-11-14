import type { ChatMessage } from '../infra/llm.js'
import type { AssistantContext } from '../../shared/assistant.js'
import type { PaperIR } from '../../shared/ir.js'
import { QUESTION_TYPE_LABEL } from '../../shared/ir.js'
import type { PaperStats } from '../domain/stats.js'

export const ASSISTANT_PROMPT_VERSION = 'assistant.v1'

const SYSTEM = `你是"墨卷"的命题助手，服务对象是中学老师。墨卷能根据教学大纲自动出一份可编辑、可校验的试卷。

你可以做两类事：
1. 回答问题：命题技巧、难度控制、知识点覆盖、怎么用这个产品；
2. 执行改题：当老师明确要求修改某一道题时，动手改。

回答规则：
- 中文，简洁，先给结论再给理由；单次不超过 200 字；
- 只能引用上下文里真实出现的题目，绝不编造题号或题干；
- 不确定时就直接说"需要你先打开某份试卷"。

动作规则（重要）：
- 只有当老师明确要求"改某题/换掉某题/调难度/改选项/补解析"时才执行动作；
- 动作必须写在回答的最后，单独一行，格式严格如下：
<action>{"type":"revise_question","index":3,"instruction":"把难度提高到 4，并替换干扰项"}</action>
- index 是题号（从 1 开始，对应上下文里的 [1] [2]…）；
- instruction 用一句话写清怎么改，不要复述原题；
- 一次最多一个动作；纯咨询类问题不要输出动作块。`

function describePaper(paper: PaperIR): string {
  const questions = paper.sections.flatMap((s) => s.questions)
  const lines = questions.map((q, i) => {
    const stem = q.stem.replace(/\$/g, '').replace(/\s+/g, ' ').slice(0, 42)
    return `[${i + 1}] ${QUESTION_TYPE_LABEL[q.type]} ${q.score}分 难度${q.difficulty}：${stem}${q.stem.length > 42 ? '…' : ''}`
  })
  return [
    `试卷：《${paper.title}》（${paper.subject} · ${paper.grade}，满分 ${paper.totalScore}，${questions.length} 题）`,
    ...lines,
  ].join('\n')
}

function describeStats(stats: PaperStats): string {
  const weak = stats.knowledge.slice(0, 3).map((k) => `${k.knowledgePoint} ${k.accuracy}%`)
  return [
    `学情：${stats.submissions} 份提交，平均得分率 ${stats.avgPercent}%，及格率 ${stats.passRate}%`,
    weak.length > 0 ? `最弱知识点：${weak.join('；')}` : '暂无知识点数据',
  ].join('\n')
}

export interface AssistantPromptInput {
  context: AssistantContext
  paper: PaperIR | null
  stats: PaperStats | null
}

export function buildAssistantMessages(
  input: AssistantPromptInput,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): ChatMessage[] {  const contextLines: string[] = [`当前页面：${input.context.page}`]

  if (input.paper) {
    contextLines.push(describePaper(input.paper))
    if (input.context.questionIndex) {
      contextLines.push(`老师正在看第 ${input.context.questionIndex} 题`)
    }
  } else if (input.context.paperId) {
    contextLines.push('（当前试卷已不存在，可能需要重新生成）')
  } else {
    contextLines.push('老师还没有打开任何试卷')
  }

  if (input.stats) contextLines.push(describeStats(input.stats))

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `当前上下文：\n${contextLines.join('\n')}` },
  ]

  // 只带最近 8 轮，避免把上下文撑爆
  for (const item of history.slice(-8)) {
    messages.push({ role: item.role, content: item.content })
  }
  return messages
}

/**
 * 学生端的学习助手——和教师端的命题助手是**两套独立提示词**。
 * 关键差别：它没有任何"动作"，不能改卷子，也拿不到别的学生的数据。
 */
const STUDENT_SYSTEM = `你是"墨卷"的学习助手，服务对象是中学生。

你能看到的上下文：这份试卷的题目、标准答案与解析，以及这名学生某次作答的错题。

回答规则：
- 用中学生听得懂的话：先讲这道题考什么，再讲他错在哪，最后给一句马上能用的方法；
- 一次回答不超过 200 字，讲清一点比讲全更重要；
- 只能引用上下文里真实出现的题目和信息，不编造分数、排名、其他同学的任何情况；
- 你能看到答案，但不要在学生还没作答时直接报答案；如果学生是在问"该怎么做"，先给思路；
- 你没有修改试卷、查看班级数据的能力，也不要声称能代为操作；
- 与学习无关的话题礼貌拒绝，把话题带回这道题。`

export function buildStudentMessages(
  paper: PaperIR | null,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: STUDENT_SYSTEM }]
  messages.push({
    role: 'system',
    content: paper ? `当前试卷：\n${describePaper(paper)}` : '当前没有可用的试卷信息。',
  })
  for (const item of history.slice(-8)) {
    messages.push({ role: item.role, content: item.content })
  }
  return messages
}
