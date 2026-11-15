/**
 * 自检脚本 —— 评委只需要看这一条命令的输出。
 *
 * 设计约束：**不允许依赖 API Key 与网络**。
 * 它验证的是"这份交付能不能在陌生机器上跑通闭环"，而不是"作者的电脑能不能调通模型"。
 *
 * 用法：npm run verify
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在加载 config 之前设置：强制演示模式 + 隔离数据目录
process.env.MUJUAN_DISABLE_ENV_FILE = '1'
process.env.DB_DRIVER = 'json'
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'mujuan-verify-'))
delete process.env.DEEPSEEK_API_KEY

const { loadConfig } = await import('../server/config.js')
const { createRepo } = await import('../server/infra/repo.js')
const { buildApp } = await import('../server/app.js')
const { generatePaper } = await import('../server/domain/generator.js')
const { createDemoPort, loadDemoPaper } = await import('../server/infra/demo.js')
const { validatePaper } = await import('../server/domain/validator.js')
const { paperSchema } = await import('../shared/ir.js')
const { isDemo } = await import('../server/settings.js')
const katex = (await import('katex')).default

const checks: Array<{ name: string; run: () => Promise<string> }> = []
const results: Array<{ name: string; ok: boolean; detail: string }> = []

function check(name: string, run: () => Promise<string>): void {
  checks.push({ name, run })
}

const config = loadConfig()
const repo = await createRepo(config)
await repo.init()
const app = await buildApp({ config, repo, role: 'teacher' })
const studentApp = await buildApp({ config, repo, role: 'student' })

// ── 登录：两个端都要带上会话，否则所有接口 401 ──────────────────
const { ensureBootstrapTeacher } = await import('../server/auth/users.js')
const boot = ensureBootstrapTeacher()

let T_COOKIE = ''
let S_COOKIE = ''

const tInject = (opts: Record<string, unknown>) =>
  app.inject({ ...opts, headers: { cookie: T_COOKIE, ...((opts.headers as Record<string, string>) ?? {}) } } as never)
const sInject = (opts: Record<string, unknown>) =>
  studentApp.inject({ ...opts, headers: { cookie: S_COOKIE, ...((opts.headers as Record<string, string>) ?? {}) } } as never)

const tLogin = await app.inject({
  method: 'POST',
  url: '/api/auth/login',
  payload: { username: boot.username, password: boot.password },
})
if (tLogin.statusCode !== 200) throw new Error('教师账号登录失败，自检无法继续')
T_COOKIE = String(tLogin.headers['set-cookie'] ?? '').split(';')[0] ?? ''

const seeded = await app.inject({
  method: 'POST',
  url: '/api/users',
  headers: { cookie: T_COOKIE, 'content-type': 'application/json' },
  payload: { username: 'zijian', displayName: '自检同学', password: 'test123456', role: 'student' },
})
if (seeded.statusCode !== 200 && seeded.statusCode !== 409) throw new Error('创建自检学生失败')

const sLogin = await studentApp.inject({
  method: 'POST',
  url: '/api/auth/login',
  payload: { username: 'zijian', password: 'test123456' },
})
if (sLogin.statusCode !== 200) throw new Error('学生账号登录失败')
S_COOKIE = String(sLogin.headers['set-cookie'] ?? '').split(';')[0] ?? ''

let paperId = ''
let generated = null as Awaited<ReturnType<typeof generatePaper>> | null
let baselineStems = ''
let studentScore = 0

check('环境与仓储初始化', async () => {
  if (repo.driver !== 'json') throw new Error(`期望 json 驱动，实际 ${repo.driver}`)
  return `驱动 ${repo.driver}，演示模式=${isDemo()}`
})

check('回放生成一份试卷且 IR 通过 zod', async () => {
  if (!isDemo()) throw new Error('自检必须运行在演示模式（不应读取真实接入配置）')
  const demo = loadDemoPaper()
  generated = await generatePaper({
    req: {
      outline: demo.blueprint.coverage.join('；'),
      subject: demo.subject,
      grade: demo.grade,
      totalScore: demo.totalScore,
      durationMin: demo.durationMin,
      mix: demo.blueprint.items,
    },
    llm: createDemoPort(demo, 0),
    emit: () => {},
    modelName: 'verify-replay',
  })
  const parsed = paperSchema.safeParse(generated.ir)
  if (!parsed.success) throw new Error(`IR 结构不合法：${parsed.error.issues[0]?.message}`)
  // 先留存基线题干，后续步骤会改题，不能拿被改过的对象做确定性比对
  baselineStems = generated.ir.sections.flatMap((s) => s.questions.map((q) => q.stem)).join('|')
  const record = await repo.createPaper(generated.ir)
  paperId = record.id
  return `${generated.ir.sections[0]?.questions.length ?? 0} 题 · 满分 ${generated.ir.totalScore}`
})

check('业务规则校验（分值/答案/蓝图一致）', async () => {
  if (!generated) throw new Error('前置步骤未完成')
  const issues = validatePaper(generated.ir)
  if (issues.length > 0) throw new Error(`仍有 ${issues.length} 处：${issues[0]?.message}`)
  return '0 issue'
})

check('公式可被 KaTeX 渲染', async () => {
  if (!generated) throw new Error('前置步骤未完成')
  const stems = generated.ir.sections.flatMap((s) => s.questions.map((q) => q.stem))
  const withMath = stems.find((stem) => stem.includes('$'))
  if (!withMath) throw new Error('演示卷中不含公式，无法验证渲染链路')
  const inner = withMath.split('$')[1] ?? ''
  const html = katex.renderToString(inner, { throwOnError: true, trust: false })
  if (!html.includes('katex')) throw new Error('KaTeX 输出异常')
  return `渲染 $${inner.slice(0, 18)}…$ 成功`
})

check('人工改题可持久化', async () => {
  const detail = await tInject({ method: 'GET', url: `/api/papers/${paperId}` })
  if (detail.statusCode !== 200) throw new Error(`读取试卷失败 ${detail.statusCode}`)
  const body = detail.json() as { paper: { sections: Array<{ questions: Array<{ id: string }> }> } }
  const qid = body.paper.sections[0]?.questions[0]?.id
  if (!qid) throw new Error('试卷没有题目')

  const res = await tInject({
    method: 'PATCH',
    url: `/api/papers/${paperId}/questions/${qid}`,
    payload: { score: 7 },
  })
  if (res.statusCode !== 200) throw new Error(`改题失败 ${res.statusCode}`)
  const updated = res.json() as { question: { status: string; score: number } }
  if (updated.question.status !== 'edited') throw new Error('改题后状态未标记为 edited')
  return `题 ${qid} 改为 ${updated.question.score} 分并标记 edited`
})

check('提交作答 → 确定性评分', async () => {
  if (!generated) throw new Error('前置步骤未完成')
  await tInject({ method: 'POST', url: `/api/papers/${paperId}/publish` })
  const questions = generated.ir.sections.flatMap((s) => s.questions)
  const answers: Record<string, string[]> = {}
  for (const q of questions) answers[q.id] = q.answers
  const res = await tInject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId, student: '自检同学', answers },
  })
  if (res.statusCode !== 200) throw new Error(`交卷失败 ${res.statusCode}：${res.body.slice(0, 120)}`)
  const body = res.json() as { score: number; maxScore: number }
  studentScore = body.score
  if (Math.abs(body.score - body.maxScore) > 0.01) {
    throw new Error(`全对却未得满分：${body.score}/${body.maxScore}`)
  }
  return `${body.score}/${body.maxScore} 分（全对）`
})

check('学情统计与作答一致', async () => {
  const res = await tInject({ method: 'GET', url: `/api/papers/${paperId}/stats` })
  if (res.statusCode !== 200) throw new Error(`统计失败 ${res.statusCode}`)
  const body = res.json() as {
    stats: { submissions: number; avgPercent: number; knowledge: unknown[] }
  }
  if (body.stats.submissions !== 1) throw new Error(`提交数应为 1，实际 ${body.stats.submissions}`)
  if (body.stats.avgPercent !== 100) throw new Error(`平均得分率应为 100，实际 ${body.stats.avgPercent}`)
  if (body.stats.knowledge.length === 0) throw new Error('知识点聚合为空')
  return `${body.stats.submissions} 份 · 平均 ${body.stats.avgPercent}% · ${body.stats.knowledge.length} 个知识点`
})

check('成绩单 CSV 带 BOM、表头正确', async () => {
  const res = await tInject({ method: 'GET', url: `/api/papers/${paperId}/attempts.csv` })
  if (res.statusCode !== 200) throw new Error(`导出失败 ${res.statusCode}`)
  // 没 BOM 的话 Excel 打开中文必乱码，这条不能再退回去
  if (!res.body.startsWith('\ufeff')) throw new Error('CSV 缺少 BOM')
  const lines = res.body.replace(/^\ufeff/, '').split('\r\n').filter(Boolean)
  if (!lines[0]?.includes('姓名')) throw new Error(`表头异常：${lines[0]}`)
  if (lines.length < 2) throw new Error('没有数据行')
  const contentType = String(res.headers['content-type'] ?? '')
  if (!contentType.includes('text/csv')) throw new Error(`Content-Type 异常：${contentType}`)
  return `${lines.length - 1} 行成绩 · ${contentType}`
})

check('学生端：只见已发布卷，错题带原始作答', async () => {
  if (!generated) throw new Error('前置步骤未完成')

  const draft = await repo.createPaper(generated.ir)
  const list = await sInject({ method: 'GET', url: '/api/student/papers' })
  if (list.statusCode !== 200) throw new Error(`学生端列表失败 ${list.statusCode}`)
  const items = (list.json() as { items: Array<{ id: string }> }).items
  if (items.some((item) => item.id === draft.id)) throw new Error('草稿出现在了学生端列表')

  // 故意答错一题，验证错题回顾拿得到原始作答
  const questions = generated.ir.sections.flatMap((s) => s.questions)
  const answers: Record<string, string[]> = {}
  for (const q of questions) {
    answers[q.id] = q.type === 'single' ? ['ZZZ'] : q.answers
  }
  const created = await sInject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId, student: '自检同学', answers },
  })
  if (created.statusCode !== 200) throw new Error(`交卷失败 ${created.statusCode}`)
  const attemptId = (created.json() as { attemptId: string }).attemptId

  const detail = await sInject({ method: 'GET', url: `/api/attempts/${attemptId}` })
  if (detail.statusCode !== 200) throw new Error(`错题回顾失败 ${detail.statusCode}`)
  const body = detail.json() as { review: Array<{ myAnswer?: string[] }> }
  if (body.review.length === 0) throw new Error('错题列表为空')
  if (body.review[0]?.myAnswer === undefined) throw new Error('错题没有记录原始作答')

  await repo.deletePaper(draft.id)
  return `${items.length} 份可见 · ${body.review.length} 道错题可回顾`
})

check('鉴权：未登录 401，走错端被挡', async () => {
  const anon = await app.inject({ method: 'GET', url: '/api/papers' })
  if (anon.statusCode !== 401) throw new Error(`未登录应为 401，实际 ${anon.statusCode}`)

  // 注意：这里必须用原始 inject，不能带会话，否则测不到"未登录"
  const anonymousAttempt = await app.inject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId, student: '冒名者', answers: {} },
  })
  if (anonymousAttempt.statusCode !== 401) throw new Error('未登录交卷应为 401')

  const wrongPort = await studentApp.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: boot.username, password: boot.password },
  })
  if (wrongPort.statusCode !== 403) {
    throw new Error(`教师账号在学生端登录应为 403，实际 ${wrongPort.statusCode}`)
  }

  const badPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: boot.username, password: 'wrong-password' },
  })
  if (badPassword.statusCode !== 401) throw new Error('密码错误应为 401')

  return '未登录 401 · 未登录交卷 401 · 走错端 403 · 错密码 401'
})

check('两端路由面隔离：学生端碰不到出卷与改题', async () => {
  const health = await sInject({ method: 'GET', url: '/api/health' })
  if (health.statusCode !== 200) throw new Error(`学生端健康检查失败 ${health.statusCode}`)
  const body = health.json() as { role?: string }
  if (body.role !== 'student') throw new Error(`学生端 role 应为 student，实际 ${body.role}`)

  // 学生端根本不该注册这些路由 —— 是"路不存在"，不是"被权限挡住"
  const attempts = [
    ['POST', '/api/papers/generate'],
    ['PATCH', `/api/papers/${paperId}/questions/q_1`],
    ['GET', `/api/papers/${paperId}/stats`],
    ['PUT', '/api/settings'],
    ['POST', '/api/assistant/chat'],
  ] as const

  for (const [method, url] of attempts) {
    const res = await sInject({ method, url, payload: {} })
    if (res.statusCode !== 404) {
      throw new Error(`学生端不应暴露 ${method} ${url}，实际 ${res.statusCode}`)
    }
  }

  // 反向也成立：教师端没有学生端入口
  const reverse = await tInject({ method: 'GET', url: '/api/student/papers' })
  if (reverse.statusCode !== 404) throw new Error('教师端不应暴露学生端接口')

  return `${attempts.length} 条教师端接口在学生端均为 404`
})

check('交卷：不依赖请求体里的 student，且不可冒充', async () => {
  // 前端早已改成"身份来自会话"；如果接口还把 student 当必填，整片交卷会 400
  const bare = await sInject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId, answers: {} },
  })
  if (bare.statusCode !== 200) {
    throw new Error(`不带 student 的交卷应成功，实际 ${bare.statusCode}`)
  }

  // 多传一个 student 也不能被采信
  const spoof = await sInject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId, student: '冒名者', answers: {} },
  })
  if (spoof.statusCode !== 200) throw new Error(`交卷失败 ${spoof.statusCode}`)
  const attemptId = (spoof.json() as { attemptId: string }).attemptId

  const detail = await sInject({ method: 'GET', url: `/api/attempts/${attemptId}` })
  const studentName = (detail.json() as { attempt: { student: string } }).attempt.student
  if (studentName !== '自检同学') {
    throw new Error(`身份应取会话（自检同学），实际记录为 ${studentName}`)
  }

  return '空 student 可交卷 · 伪造 student 被忽略'
})

check('草稿试答：可交卷但不污染学情', async () => {
  if (!generated) throw new Error('前置步骤未完成')
  // 新建一份草稿（不发布），直接交卷
  const draft = await repo.createPaper(generated.ir)
  const questions = generated.ir.sections.flatMap((s) => s.questions)
  const answers: Record<string, string[]> = {}
  for (const q of questions) answers[q.id] = q.answers

  const res = await tInject({
    method: 'POST',
    url: '/api/attempts',
    payload: { paperId: draft.id, student: '试答老师', answers },
  })
  if (res.statusCode !== 200) {
    throw new Error(`草稿试答应被接受，实际 ${res.statusCode}：${res.body.slice(0, 120)}`)
  }
  const body = res.json() as { preview: boolean; score: number }
  if (!body.preview) throw new Error('草稿试答未被标记 preview')

  const statsRes = await tInject({ method: 'GET', url: `/api/papers/${draft.id}/stats` })
  const stats = statsRes.json() as { stats: { submissions: number } }
  if (stats.stats.submissions !== 0) {
    throw new Error(`试答不应计入统计，实际 ${stats.stats.submissions} 份`)
  }
  await repo.deletePaper(draft.id)
  return `得 ${body.score} 分，统计仍为 0 份`
})

check('空 JSON body 的 POST / DELETE 不再 400', async () => {
  if (!generated) throw new Error('前置步骤未完成')
  // 前端曾经给所有请求都加 Content-Type: application/json，
  // 于是"发布/删除"这类无 body 的调用整片 400。这里固化成回归测试。
  const scratch = await repo.createPaper(generated.ir)

  const res = await tInject({
    method: 'POST',
    url: `/api/papers/${scratch.id}/publish`,
    headers: { 'content-type': 'application/json' },
    payload: '',
  })
  if (res.statusCode !== 200) {
    throw new Error(`空 body 的 POST 应被接受，实际 ${res.statusCode}：${res.body.slice(0, 120)}`)
  }

  const del = await tInject({
    method: 'DELETE',
    url: `/api/papers/${scratch.id}`,
    headers: { 'content-type': 'application/json' },
  })
  if (del.statusCode !== 200) {
    throw new Error(`空 body 的 DELETE 应被接受，实际 ${del.statusCode}：${del.body.slice(0, 120)}`)
  }
  return `POST ${res.statusCode} / DELETE ${del.statusCode}`
})

check('接入配置不回传密钥', async () => {
  const res = await tInject({ method: 'GET', url: '/api/settings' })
  if (res.statusCode !== 200) throw new Error(`读取配置失败 ${res.statusCode}`)
  if (res.body.includes('"apiKey"')) throw new Error('响应体中出现了 apiKey 字段')

  const parsed = JSON.parse(res.body) as {
    settings: { hasKey: boolean; kind: string; demo: boolean }
    presets: Record<string, unknown>
  }
  if (typeof parsed.settings.hasKey !== 'boolean') throw new Error('缺少 hasKey 标识')
  if (!parsed.settings.demo) throw new Error('无 Key 时应处于演示模式')

  const presetCount = Object.keys(parsed.presets).length
  if (presetCount < 4) throw new Error(`预设数量异常：${presetCount}`)
  return `${presetCount} 种接入预设 · 密钥已脱敏 · 当前演示模式`
})

check('IR 导出可下载且结构完整', async () => {
  const res = await tInject({ method: 'GET', url: `/api/papers/${paperId}/paper.json` })
  if (res.statusCode !== 200) throw new Error(`导出失败 ${res.statusCode}`)
  const parsed = paperSchema.safeParse(JSON.parse(res.body))
  if (!parsed.success) throw new Error('导出的 IR 结构不合法')
  const disposition = res.headers['content-disposition']
  if (!String(disposition ?? '').includes('.paper.json')) throw new Error('缺少下载文件名')
  return `${res.body.length} 字节 · schema ${parsed.data.schema}`
})

check('演示模式下助手明确拒绝而非假装回答', async () => {
  const res = await tInject({
    method: 'POST',
    url: '/api/assistant/chat',
    payload: { messages: [{ role: 'user', content: '你好' }], context: { page: 'compose' } },
  })
  if (res.statusCode !== 409) {
    throw new Error(`演示模式下应返回 409，实际 ${res.statusCode}`)
  }
  const body = res.json() as { error?: string }
  if (body.error !== 'DEMO_MODE') throw new Error('缺少 DEMO_MODE 错误码')
  return '返回 409 DEMO_MODE，引导先去配置接入'
})

check('无 Key 回放具备确定性', async () => {
  const demo = loadDemoPaper()
  const again = await generatePaper({
    req: {
      outline: demo.blueprint.coverage.join('；'),
      subject: demo.subject,
      grade: demo.grade,
      totalScore: demo.totalScore,
      durationMin: demo.durationMin,
      mix: demo.blueprint.items,
    },
    llm: createDemoPort(demo, 0),
    emit: () => {},
    modelName: 'verify-replay',
  })
  const second = again.ir.sections.flatMap((s) => s.questions.map((q) => q.stem)).join('|')
  if (baselineStems !== second) throw new Error('两次回放产出的题干不一致')
  return '两次回放题干完全一致'
})

for (const item of checks) {
  try {
    const detail = await item.run()
    results.push({ name: item.name, ok: true, detail })
    console.log(`  \u2713 ${item.name}  —  ${detail}`)
  } catch (error) {
    results.push({ name: item.name, ok: false, detail: (error as Error).message })
    console.log(`  \u2717 ${item.name}  —  ${(error as Error).message}`)
  }
}

await app.close()
await studentApp.close()
rmSync(process.env.DATA_DIR, { recursive: true, force: true })

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
