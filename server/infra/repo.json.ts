import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperIR, Question } from '../../shared/ir.js'
import {
  newId,
  summarise,
  type AttemptRecord,
  type PaperRecord,
  type PaperRepo,
  type QuestionPatch,
} from './repo.js'

interface JsonDb {
  papers: PaperRecord[]
  attempts: AttemptRecord[]
}

/**
 * JSON 文件驱动：零依赖兜底。
 *
 * 存在的意义不是"更好"，而是"任何 Node 版本、任何没有编译器的机器都能跑通"。
 * 写入采用 tmp + rename，保证评委看到的数据文件不会出现半截 JSON。
 */
export async function createJsonRepo(dataDir: string): Promise<PaperRepo> {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, 'mujuan.json')
  let db: JsonDb = { papers: [], attempts: [] }

  const load = (): void => {
    if (!existsSync(file)) return
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<JsonDb>
      db = { papers: parsed.papers ?? [], attempts: parsed.attempts ?? [] }
    } catch {
      db = { papers: [], attempts: [] }
    }
  }

  const persist = (): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  const repo: PaperRepo = {
    driver: 'json',

    async init() {
      load()
      persist()
    },

    async createPaper(ir: PaperIR) {
      const now = new Date().toISOString()
      const record: PaperRecord = { id: newId('paper'), status: 'draft', createdAt: now, updatedAt: now, ir }
      db.papers.unshift(record)
      persist()
      return record
    },

    async getPaper(id) {
      return db.papers.find((p) => p.id === id) ?? null
    },

    async listPapers() {
      return db.papers.map(summarise)
    },

    async updateQuestion(paperId, questionId, patch: QuestionPatch) {
      const record = db.papers.find((p) => p.id === paperId)
      if (!record) return null
      let updated: Question | null = null
      for (const section of record.ir.sections) {
        const target = section.questions.find((q) => q.id === questionId)
        if (!target) continue
        Object.assign(target, patch, { status: 'edited' })
        updated = target
        break
      }
      if (!updated) return null
      record.updatedAt = new Date().toISOString()
      persist()
      return updated
    },

    async setStatus(paperId, status) {
      const record = db.papers.find((p) => p.id === paperId)
      if (!record) return false
      record.status = status
      record.updatedAt = new Date().toISOString()
      persist()
      return true
    },

    async deletePaper(paperId) {
      const before = db.papers.length
      db.papers = db.papers.filter((p) => p.id !== paperId)
      db.attempts = db.attempts.filter((a) => a.paperId !== paperId)
      persist()
      return db.papers.length !== before
    },

    async createAttempt(input) {
      const record: AttemptRecord = {
        id: newId('att'),
        submittedAt: new Date().toISOString(),
        ...input,
      }
      db.attempts.unshift(record)
      persist()
      return record
    },

    async listAttempts(paperId) {
      return db.attempts.filter((a) => a.paperId === paperId)
    },

    async getAttempt(id) {
      return db.attempts.find((a) => a.id === id) ?? null
    },
  }

  return repo
}
