import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 排行榜可见性设置：按试卷存。
 *
 * 单独一份 JSON 而不进 PaperRepo，理由同 users.json——这是"配置级"数据，
 * 量小、结构简单，避免为 sqlite / json 两个驱动各写一遍同样的逻辑。
 */
export interface RankingSetting {
  /** 老师是否授权学生查看 */
  enabled: boolean
  /** 查看周期，null 表示不限制 */
  startAt: string | null
  endAt: string | null
}

const DEFAULT: RankingSetting = { enabled: false, startAt: null, endAt: null }

function file(): string {
  return join(resolve(process.cwd(), process.env.DATA_DIR ?? 'data'), 'ranking.json')
}

function readAll(): Record<string, RankingSetting> {
  const path = file()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, RankingSetting>
  } catch {
    return {}
  }
}

export function getSetting(paperId: string): RankingSetting {
  return readAll()[paperId] ?? DEFAULT
}

export function setSetting(paperId: string, next: RankingSetting): RankingSetting {
  const all = readAll()
  all[paperId] = next
  const path = file()
  mkdirSync(resolve(process.cwd(), process.env.DATA_DIR ?? 'data'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return next
}

/**
 * 学生此刻能否看到这份卷子的排行榜：
 * 未授权一律不可见；设了周期则按服务器本地时间判断。
 */
export function isRankingVisible(paperId: string, now = new Date()): boolean {
  const setting = getSetting(paperId)
  if (!setting.enabled) return false
  const time = now.getTime()
  if (setting.startAt && new Date(setting.startAt).getTime() > time) return false
  if (setting.endAt && new Date(setting.endAt).getTime() < time) return false
  return true
}
