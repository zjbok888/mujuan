/**
 * 播种演示数据：生成一份试卷、发布、再灌入一批确定性的作答记录。
 *
 * 目的只有一个：让任何人 `npm run seed` 之后，学情页立刻是有内容的，
 * 而不是打开一片空白。作答分布用固定种子的伪随机数生成，可重复。
 *
 * 前置：服务已在运行（npm run dev 或 npm start）。
 * 用法：node_modules/.bin/tsx scripts/seed-demo.ts
 */
const BASE = process.env.SEED_BASE_URL ?? 'http://127.0.0.1:4000'
const STUDENTS = [
  '陈知远', '林小满', '周允之', '苏木', '何清野', '江蘅',
  '徐见山', '孟星野', '柳砚', '白露', '沈砚青', '顾南舟',
]

/** mulberry32：固定种子的伪随机，保证每次播种的分数分布一致 */
function makeRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

interface Question {
  id: string
  type: string
  options?: Array<{ key: string }>
  answers: string[]
}

interface PaperResponse {
  id: string
  status: string
  paper: { sections: Array<{ questions: Question[] }> }
}

async function generatePaper(): Promise<string> {
  const body = {
    outline: `人教版高中数学选择性必修二 · 第五章《导数及其应用》
1. 导数的定义与几何意义（切线斜率）；2. 基本求导公式与四则运算法则；
3. 利用导数判断函数的单调性与极值；4. 闭区间上函数的最大值与最小值；
5. 导数在实际优化问题中的简单应用。易错点：把"导数为零"当成"极值点"、忽略定义域。`,
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

  const res = await fetch(`${BASE}/api/papers/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) throw new Error(`生成失败：${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let paperId = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n\n')
    while (idx >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const event = JSON.parse(line.slice(5).trim()) as { type: string; paperId?: string; message?: string }
          if (event.type === 'paper.done' && event.paperId) paperId = event.paperId
          if (event.type === 'error') console.warn('[seed] 生成警告：', event.message)
        } catch {
          /* 忽略半截帧 */
        }
      }
      idx = buffer.indexOf('\n\n')
    }
  }
  if (!paperId) throw new Error('未拿到 paperId')
  return paperId
}

function buildAnswers(questions: Question[], rand: () => number) {
  const answers: Record<string, string[]> = {}
  for (const question of questions) {
    const skill = rand() // 每个学生每道题的"掌握度"
    if (question.type === 'single' || question.type === 'multiple') {
      const keys = (question.options ?? []).map((o) => o.key)
      if (skill > 0.45) {
        answers[question.id] = [...question.answers]
      } else if (keys.length > 0) {
        answers[question.id] = [keys[Math.floor(rand() * keys.length)] ?? keys[0]!]
      }
    } else if (question.type === 'blank') {
      answers[question.id] = skill > 0.55 ? [...question.answers] : ['（未作答）']
    } else {
      answers[question.id] =
        skill > 0.6 ? [question.answers.join('\n')] : ['只写了一部分要点，没写完']
    }
  }
  return answers
}

const paperId = await generatePaper()
console.log(`[seed] 试卷已生成：${paperId}`)

await postJson(`/api/papers/${paperId}/publish`, {})
const detailRes = await fetch(`${BASE}/api/papers/${paperId}`)
const detail = (await detailRes.json()) as PaperResponse
const questions = detail.paper.sections.flatMap((s) => s.questions)

for (let i = 0; i < STUDENTS.length; i += 1) {
  const rand = makeRandom(2026 + i * 37)
  const answers = buildAnswers(questions, rand)
  const result = await postJson<{ score: number; maxScore: number }>('/api/attempts', {
    paperId,
    student: STUDENTS[i],
    answers,
  })
  console.log(`[seed] ${STUDENTS[i]}：${result.score}/${result.maxScore}`)
}

console.log(`\n[seed] 完成。打开 ${BASE}/#/stats/${paperId} 查看学情大盘。`)

export {}
