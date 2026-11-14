import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PublicUser, Role } from '../../shared/auth.js'

/**
 * 账号存储。
 *
 * 单独用一份 JSON 而不进 PaperRepo：账号属于"配置级"小数据（几十条），
 * 走文件足够，也避免为两个数据库驱动各写一遍同样的用户逻辑。
 * 写入用 tmp + rename，避免断电时留下半个文件。
 */
interface StoredUser {
  id: string
  username: string
  displayName: string
  role: Role
  /** scrypt 盐 */
  salt: string
  /** scrypt 派生密钥（hex） */
  hash: string
  createdAt: string
}

interface UserFile {
  version: 1
  users: StoredUser[]
}

function dataDir(): string {
  return resolve(process.cwd(), process.env.DATA_DIR ?? 'data')
}

function usersFile(): string {
  return join(dataDir(), 'users.json')
}

let cache: UserFile | null = null

function load(): UserFile {
  if (cache) return cache
  const file = usersFile()
  if (!existsSync(file)) {
    cache = { version: 1, users: [] }
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as UserFile
    cache = { version: 1, users: Array.isArray(parsed.users) ? parsed.users : [] }
  } catch {
    cache = { version: 1, users: [] }
  }
  return cache
}

function persist(): void {
  const data = load()
  mkdirSync(dataDir(), { recursive: true })
  const file = usersFile()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

export function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  }
}

export function listUsers(): PublicUser[] {
  return load()
    .users.slice()
    .sort((a, b) => a.role.localeCompare(b.role) || a.createdAt.localeCompare(b.createdAt))
    .map(toPublic)
}

export function findByUsername(username: string): PublicUser | null {
  const target = username.trim().toLowerCase()
  const found = load().users.find((u) => u.username.toLowerCase() === target)
  return found ? toPublic(found) : null
}

/** 校验密码：返回账号视图，失败返回 null（不区分"用户不存在"和"密码错"，避免枚举账号） */
export function verifyLogin(username: string, password: string): PublicUser | null {
  const target = username.trim().toLowerCase()
  const user = load().users.find((u) => u.username.toLowerCase() === target)
  if (!user) return null
  const { hash } = hashPassword(password, user.salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(user.hash, 'hex')
  if (a.length !== b.length) return null
  return timingSafeEqual(a, b) ? toPublic(user) : null
}

export function createUser(input: {
  username: string
  displayName: string
  password: string
  role: Role
}): PublicUser {
  const data = load()
  const exists = data.users.some((u) => u.username.toLowerCase() === input.username.trim().toLowerCase())
  if (exists) throw new Error('账号已存在')

  const { salt, hash } = hashPassword(input.password)
  const user: StoredUser = {
    id: `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    username: input.username.trim(),
    displayName: input.displayName.trim(),
    role: input.role,
    salt,
    hash,
    createdAt: new Date().toISOString(),
  }
  data.users.push(user)
  persist()
  return toPublic(user)
}

export function resetPassword(userId: string, password: string): boolean {
  const data = load()
  const user = data.users.find((u) => u.id === userId)
  if (!user) return false
  const { salt, hash } = hashPassword(password)
  user.salt = salt
  user.hash = hash
  persist()
  return true
}

export function deleteUser(userId: string): boolean {
  const data = load()
  const index = data.users.findIndex((u) => u.id === userId)
  if (index < 0) return false
  data.users.splice(index, 1)
  persist()
  return true
}

export function countByRole(role: Role): number {
  return load().users.filter((u) => u.role === role).length
}

/**
 * 首次启动自举：没有任何教师账号时，用环境变量或默认口令建一个。
 * 返回明文口令，只在控制台打印一次——这是唯一一次能看到它的机会。
 */
export function ensureBootstrapTeacher(): { username: string; password: string; created: boolean } {
  const data = load()
  const existingTeacher = data.users.find((u) => u.role === 'teacher')
  if (existingTeacher) return { username: existingTeacher.username, password: '', created: false }

  const username = (process.env.TEACHER_USER ?? 'teacher').trim()
  const password = process.env.TEACHER_PASSWORD ?? 'mujuan2026'
  createUser({ username, displayName: '任课老师', password, role: 'teacher' })
  return { username, password, created: true }
}
