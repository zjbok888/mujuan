import type { ChatMessage } from '../infra/llm.js'
import type { Blueprint, GenerateRequest, PaperIR, QuestionType } from '../../shared/ir.js'
import { QUESTION_TYPE_LABEL } from '../../shared/ir.js'

/** 提示词版本号会写进 PaperIR.meta，便于追溯"哪一版提示词产出了哪份卷子" */
export const PROMPT_VERSION = 'v1.3.0'

const PLAN_SYSTEM = `你是一位资深命题教师，擅长依据教学大纲规划试卷结构。
只输出 JSON 对象，不要解释、不要 Markdown 代码块、不要前后缀文字。

JSON 结构：
{
  "title": "试卷标题（12-30 字，含学科与考查范围）",
  "coverage": ["知识点1", "知识点2"],
  "difficulty": { "d1": 2, "d2": 3, "d3": 1, "d4": 1, "d5": 0 },
  "rationale": "80 字以内的命题思路"
}

硬性约束：
1. coverage 给 4-8 个知识点，必须是用户大纲中真实出现的概念，不得凭空发明；
2. difficulty 的 d1..d5 之和必须等于用户指定的总题数；
3. 不得输出 items 字段，题型配比由系统固定。`

const ITEMS_SYSTEM = `你是一位资深命题教师。根据蓝图与系统给定的题位清单命制题目。
只输出 JSON 对象：{"questions": [ ... ]}，不要任何解释或代码块。

每道题字段：
- type: "single" | "multiple" | "blank" | "short"
- stem: 题干（可含 $...$ 包裹的 LaTeX 公式）
- options: 仅选择题需要，[{ "key": "A", "text": "..." }]
- answers: 字符串数组
- keywordRubric: 仅简答题需要，[{ "keyword": "要点", "points": 2 }]
- difficulty: 1-5 的整数
- knowledgePoints: 从蓝图 coverage 中选取 1-3 个
- explanation: 60 字以内解析

硬性约束（违反即视为不合格）：
1. 题位清单里的顺序、题型、分值不可更改，不得增删题目；
2. 单选题 4 个选项，answers 恰好 1 项且必须是选项 key；
3. 多选题 4 个选项，answers 为 2-3 项且必须是选项 key；
4. 填空题 answers 给 1-2 个最简标准答案（如 "2"、"x=1"），不要写"答案是"；
5. 简答题 answers[0] 写完整的参考解答；keywordRubric 是评分细则，每条 { "keyword": "...", "points": 数字 }，
   keyword 必须是从 answers[0] 中【原样截取】的 2-10 字片段（如 "极大值"、"$a\\ge 2$"、"单调递增"），
   绝不允许写成"正确求出…""说明…"这类描述性长句——评分程序只做字面匹配；
   keywordRubric 各项 points 之和必须精确等于该题分值；
6. 题干不得与"已出题目"重复，也不得两题考同一个点；
7. 公式一律用 LaTeX，例如 $\\frac{1}{2}x^2$、$\\sqrt{3}$。`

const REPAIR_SYSTEM = `你是试卷质检员。输入是一份 JSON 试卷与一份校验问题清单。
只输出修正后的完整 JSON 对象（结构与原试卷完全一致），不要解释。

修正原则：
1. 只修问题清单指出的地方，其他题目原样保留；
2. score、id、type 三个字段绝对不可改动；
3. 若问题无法在其题内修复，就把该题换成同题型同分值的另一道题；
4. 修完后自查：分值合计、答案是否落在选项内、简答题细则分值是否等于题目分值。`

function typeLine(items: Blueprint['items']): string {
  return items
    .map((item) => `${QUESTION_TYPE_LABEL[item.type as QuestionType]} ${item.count} 题`)
    .join('、')
}

export function buildPlanMessages(req: GenerateRequest, questionCount: number): ChatMessage[] {
  const user = [
    `学科：${req.subject}`,
    `年级：${req.grade}`,
    `试卷总分：${req.totalScore} 分`,
    `考试时长：${req.durationMin} 分钟`,
    `题型配比：${typeLine(req.mix)}`,
    `总题数：${questionCount}`,
    '',
    '教学大纲 / 本课内容：',
    req.outline,
  ].join('\n')
  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: user },
  ]
}

export interface SlotSpec {
  index: number
  type: QuestionType
  score: number
}

export function buildItemsMessages(
  req: GenerateRequest,
  blueprint: Blueprint,
  slots: SlotSpec[],
  usedStems: string[],
): ChatMessage[] {
  const slotText = slots
    .map((slot) => `题位 ${slot.index + 1}｜${QUESTION_TYPE_LABEL[slot.type]}｜${slot.score} 分`)
    .join('\n')

  const user = [
    `学科：${req.subject}｜年级：${req.grade}`,
    `蓝图覆盖知识点：${blueprint.coverage.join('、')}`,
    `命题思路：${blueprint.rationale || '（无）'}`,
    '',
    '本次需要命制的题位（顺序固定）：',
    slotText,
    '',
    usedStems.length > 0 ? `已出题目（避免重复）：\n${usedStems.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '已出题目：无',
    '',
    '教学大纲 / 本课内容：',
    req.outline,
  ].join('\n')

  return [
    { role: 'system', content: ITEMS_SYSTEM },
    { role: 'user', content: user },
  ]
}

export function buildRepairMessages(paper: PaperIR, brief: string): ChatMessage[] {
  const user = [
    '校验问题清单：',
    brief,
    '',
    '待修正试卷 JSON：',
    JSON.stringify(paper),
  ].join('\n')
  return [
    { role: 'system', content: REPAIR_SYSTEM },
    { role: 'user', content: user },
  ]
}
