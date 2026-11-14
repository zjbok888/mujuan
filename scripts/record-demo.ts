/**
 * 录制演示数据：用真实模型生成一份试卷，落盘为 fixtures/demo-paper.json。
 *
 * 为什么需要录制：DEMO_MODE 要能在断网、无 Key 的机器上跑通全流程，
 * 就必须有一份"真的由模型生成过"的产物，而不是手写假数据。
 *
 * 用法：npm exec -- tsx scripts/record-demo.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from '../server/config.js'
import { generatePaper, type LlmPort } from '../server/domain/generator.js'
import { streamChat } from '../server/infra/llm.js'
import type { GenerateRequest } from '../shared/ir.js'

const OUTLINE = `人教版高中数学选择性必修二 · 第五章《导数及其应用》
本节覆盖以下内容：
1. 导数的定义与几何意义（切线斜率）；
2. 基本求导公式与四则运算法则；
3. 利用导数判断函数的单调性与极值；
4. 闭区间上函数的最大值与最小值；
5. 导数在实际优化问题中的简单应用。
学生易错点：把"导数为零"直接当成"极值点"、忽略定义域、极值与最值混淆。`

const request: GenerateRequest = {
  outline: OUTLINE,
  subject: '数学',
  grade: '高二',
  totalScore: 100,
  durationMin: 45,
  mix: [
    { type: 'single', count: 4 },
    { type: 'blank', count: 2 },
    { type: 'short', count: 1 },
  ],
}

const config = loadConfig()
if (!config.llm.apiKey) {
  console.error('[record] 未配置 DEEPSEEK_API_KEY，无法录制真实数据')
  process.exit(1)
}

const llm: LlmPort = (messages, options) =>
  streamChat(config.llm, {
    messages,
    json: options.json,
    signal: options.signal,
    onReasoning: options.onReasoning,
  })

const started = Date.now()
const seen: string[] = []

const { ir, issues, repairs } = await generatePaper({
  req: request,
  llm,
  emit: (event) => {
    if (event.type === 'item.done') {
      seen.push(`${event.index + 1}. [${event.question.type}] ${event.question.score}分 ${event.question.stem.slice(0, 40)}`)
      console.log(seen[seen.length - 1])
    }
    if (event.type === 'repair.attempt') console.log(`[repair] 第 ${event.round} 轮：${event.reason}`)
  },
  modelName: config.llm.model,
})

const dir = resolve(process.cwd(), 'fixtures')
mkdirSync(dir, { recursive: true })
const payload = {
  paper: ir,
  generatedWith: config.llm.model,
  recordedAt: new Date().toISOString(),
  tookMs: Date.now() - started,
  repairs,
}
writeFileSync(resolve(dir, 'demo-paper.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

console.log(`\n[record] 已写入 fixtures/demo-paper.json（${seen.length} 题，修复 ${repairs} 轮，耗时 ${Date.now() - started}ms）`)
if (issues.length > 0) {
  console.warn(`[record] 仍有 ${issues.length} 处校验问题：`)
  for (const issue of issues) console.warn(`  - [${issue.code}] ${issue.path} ${issue.message}`)
  process.exitCode = 2
}
