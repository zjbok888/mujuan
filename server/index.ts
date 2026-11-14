import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { createRepo } from './infra/repo.js'
import { getProvider, isDemo } from './settings.js'
import { ensureBootstrapTeacher } from './auth/users.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const repo = await createRepo(config)
  await repo.init()

  const boot = ensureBootstrapTeacher()
  if (boot.created) {
    console.log(`[mujuan] 已创建首个教师账号：${boot.username} / ${boot.password}`)
    console.log('[mujuan] 请登录后到「成员」页修改密码，或设置 TEACHER_USER / TEACHER_PASSWORD 环境变量')
  }

  // 同一个进程、同一个库，两个端口各跑一个应用：
  // 教师端和学生端的路由面、AI 助手都是分开的。
  const teacher = await buildApp({ config, repo, role: 'teacher' })
  const student = await buildApp({ config, repo, role: 'student' })

  try {
    await teacher.listen({ port: config.port, host: '127.0.0.1' })
    await student.listen({ port: config.studentPort, host: '127.0.0.1' })
  } catch (error) {
    console.error('[mujuan] 启动失败：', (error as Error).message)
    console.error('[mujuan] 端口被占用时，可以用 PORT / STUDENT_PORT 换一组')
    process.exitCode = 1
    return
  }

  const provider = getProvider()
  const mode = isDemo()
    ? '演示模式（内置回放，可在界面里切换接入）'
    : `在线模式 · ${provider.kind} · ${provider.model}`
  console.log(`[mujuan] 教师端 http://127.0.0.1:${config.port}`)
  console.log(`[mujuan] 学生端 http://127.0.0.1:${config.studentPort}`)
  console.log(`[mujuan] 持久化驱动：${repo.driver}　运行模式：${mode}`)
  console.log(`[mujuan] AI 接入：${provider.baseUrl || '未配置'}（教师端 /#/settings 可改）`)

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[mujuan] 收到 ${signal}，正在关闭…`)
    await Promise.allSettled([teacher.close(), student.close()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
