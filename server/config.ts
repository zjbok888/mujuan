import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type DbDriver = 'sqlite' | 'json'

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface AppConfig {
  port: number
  dbDriver: DbDriver
  requestedDbDriver: 'auto' | DbDriver
  demoMode: boolean
  llm: LlmConfig
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
  const requestedDbDriver: 'auto' | DbDriver =
    requested === 'sqlite' || requested === 'json' ? requested : 'auto'

  const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim()

  return {
    port: Number(process.env.PORT ?? 4000),
    requestedDbDriver,
    // 真正的驱动在 repo 工厂里按运行时能力裁决，这里只记录用户意图
    dbDriver: requestedDbDriver === 'json' ? 'json' : 'sqlite',
    demoMode: apiKey.length === 0,
    llm: {
      apiKey,
      baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: process.env.LLM_MODEL ?? 'deepseek-flash',
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
    },
    dataDir: resolve(process.cwd(), process.env.DATA_DIR ?? 'data'),
    webDist: resolve(process.cwd(), 'dist'),
  }
}

/** 日志与错误上报时脱敏 */
export function redact(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9]{16,}/g, 'sk-***redacted***')
}
