/**
 * 账号契约：两个端口共用一套账号体系。
 *
 * 为什么不让学生自助注册：一间教室里"谁能进"必须由老师决定，
 * 开放注册等于让任何人混进班级。所以账号由老师建，学生只登录。
 */
import { z } from 'zod'

export const roleSchema = z.enum(['teacher', 'student'])
export type Role = z.infer<typeof roleSchema>

/** 回传给前端的账号视图，永远不含密码字段 */
export interface PublicUser {
  id: string
  username: string
  displayName: string
  role: Role
  createdAt: string
}

export const loginSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
})

export const createUserSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[A-Za-z0-9_\u4e00-\u9fa5]+$/, '只能用字母、数字、下划线或中文'),
  displayName: z.string().min(1).max(24),
  password: z.string().min(6).max(128),
  role: roleSchema.default('student'),
})

export const resetPasswordSchema = z.object({
  password: z.string().min(6).max(128),
})
