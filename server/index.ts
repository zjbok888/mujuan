import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { createRepo } from './infra/repo.js'
import { getProvider, isDemo } from './settings.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const repo = await createRepo(config)
  await repo.init()

  const app = await buildApp({ config, repo })

  try {
    await app.listen({ port: config.port, host: '127.0.0.1' })
  } catch (error) {
    console.error('[mujuan] 启动失败：', (error as Error).message)
    process.exitCode = 1
    return
  }

  const provider = getProvider()
  const mode = isDemo()
    ? '演示模式（内置回放，可在界面里切换接入）'
    : `在线模式 · ${provider.kind} · ${provider.model}`
  console.log(`[mujuan] 服务已启动 http://127.0.0.1:${config.port}`)
  console.log(`[mujuan] 持久化驱动：${repo.driver}　运行模式：${mode}`)
  console.log(`[mujuan] AI 接入：${provider.baseUrl || '未配置'}（可在 /#/settings 修改）`)

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[mujuan] 收到 ${signal}，正在关闭…`)
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
