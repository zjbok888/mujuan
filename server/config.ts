import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface AppConfig {
  port: number
  /** 学生端单独端口；默认教师端 +1 */
  studentPort: number
  requestedDbDriver: 'auto' | 'sqlite' | 'json'
  dataDir: string
  webDist: string
}

/**
 * 读取 .env（内置解析，不引入 dotenv）。
 * Node 20.12+ 提供 process.loadEnvFile；老版本自动跳过，不影响 JSON 驱动运行。
 */
function loadEnvFile(): void {
  if (process.env.MUJUAN_DISABLE_ENV_FILE === '1') return
  const file = resolve(process.cwd(), '.env')
  if (!existsSync(file)) return
  try {
    const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile
    if (typeof loader === 'function') loader.call(process, file)
  } catch {
    // .env 语法错误不应阻止启动：交回默认值
  }
}

export function loadConfig(): AppConfig {
  loadEnvFile()
  const requested = (process.env.DB_DRIVER ?? 'auto').toLowerCase()
  const requestedDbDriver: 'auto' | 'sqlite' | 'json' =
    requested === 'sqlite' || requested === 'json' ? requested : 'auto'

  return {
    port: Number(process.env.PORT ?? 4000),
    studentPort: Number(process.env.STUDENT_PORT ?? Number(process.env.PORT ?? 4000) + 1),
    requestedDbDriver,
    dataDir: resolve(process.cwd(), process.env.DATA_DIR ?? 'data'),
    webDist: resolve(process.cwd(), 'dist'),
  }
}

/** 日志与错误上报时脱敏 */
export function redact(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9]{16,}/g, 'sk-***redacted***')
}
