import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PaperIR, Question } from '../../shared/ir.js'
import type { GradeResult } from '../domain/grader.js'
import {
  newId,
  summarise,
  type AttemptRecord,
  type PaperRecord,
  type PaperRepo,
  type PaperStatus,
  type PaperSummary,
  type QuestionPatch,
} from './repo.js'

interface PaperRow {
  id: string
  status: string
  ir_json: string
  created_at: string
  updated_at: string
}

interface AttemptRow {
  id: string
  paper_id: string
  student: string
  submitted_at: string
  score: number
  max_score: number
  result_json: string
}

function toRecord(row: PaperRow): PaperRecord {
  return {
    id: row.id,
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ir: JSON.parse(row.ir_json) as PaperIR,
  }
}

/**
 * SQLite 驱动（Node 内置 node:sqlite，无原生编译依赖）。
 */
export async function createSqliteRepo(dataDir: string): Promise<PaperRepo> {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'mujuan.db'))
  db.exec('PRAGMA journal_mode = WAL')

  const init = async (): Promise<void> => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        ir_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        student TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        score REAL NOT NULL,
        max_score REAL NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_paper ON attempts(paper_id);
    `)
  }

  const readPaper = (id: string): PaperRecord | null => {
    const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow | undefined
    return row ? toRecord(row) : null
  }

  const repo: PaperRepo = {
    driver: 'sqlite',
    init,

    async createPaper(ir) {
      const now = new Date().toISOString()
      const id = newId('paper')
      db.prepare('INSERT INTO papers (id, status, ir_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        'draft',
        JSON.stringify(ir),
        now,
        now,
      )
      return { id, status: 'draft', createdAt: now, updatedAt: now, ir }
    },

    async getPaper(id) {
      return readPaper(id)
    },

    async listPapers(): Promise<PaperSummary[]> {
      const rows = db.prepare('SELECT * FROM papers ORDER BY created_at DESC').all() as unknown as PaperRow[]
      return rows.map((row) => summarise(toRecord(row)))
    },

    async updateQuestion(paperId, questionId, patch) {
      const record = readPaper(paperId)
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
      db.prepare('UPDATE papers SET ir_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(record.ir),
        new Date().toISOString(),
        paperId,
      )
      return updated
    },

    async setStatus(paperId: string, status: PaperStatus) {
      const result = db
        .prepare('UPDATE papers SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, new Date().toISOString(), paperId)
      return Number(result.changes) > 0
    },

    async deletePaper(paperId: string) {
      db.prepare('DELETE FROM attempts WHERE paper_id = ?').run(paperId)
      const result = db.prepare('DELETE FROM papers WHERE id = ?').run(paperId)
      return Number(result.changes) > 0
    },

    async createAttempt(input) {
      const record: AttemptRecord = {
        id: newId('att'),
        submittedAt: new Date().toISOString(),
        ...input,
      }
      db.prepare(
        'INSERT INTO attempts (id, paper_id, student, submitted_at, score, max_score, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        record.id,
        record.paperId,
        record.student,
        record.submittedAt,
        record.score,
        record.maxScore,
        JSON.stringify(record.result),
      )
      return record
    },

    async listAttempts(paperId) {
      const rows = db
        .prepare('SELECT * FROM attempts WHERE paper_id = ? ORDER BY submitted_at ASC')
        .all(paperId) as unknown as AttemptRow[]
      return rows.map((row) => ({
        id: row.id,
        paperId: row.paper_id,
        student: row.student,
        submittedAt: row.submitted_at,
        score: row.score,
        maxScore: row.max_score,
        result: JSON.parse(row.result_json) as GradeResult,
      }))
    },
  }

  return repo
}
