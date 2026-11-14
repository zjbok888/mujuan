import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { ProviderKind, ProviderSettings, PublicSettings } from '../shared/settings.js'
import { PROVIDER_PRESETS, providerKindSchema } from '../shared/settings.js'

/**
 * 运行时 AI 配置。
 *
 * 优先级：data/settings.json（界面里保存的） &gt; 环境变量 &gt; 预设默认值。
 * 之所以让界面配置压过 .env：用户在界面上明确改过，就应该是生效的那一个。
 */
const storedSchema = z.object({
  kind: providerKindSchema.default('deepseek'),
  baseUrl: z.string().max(300).default(''),
  model: z.string().max(120).default(''),
  apiKey: z.string().max(300).default(''),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(5000).max(300000).default(90000),
})

type Stored = z.infer<typeof storedSchema>

let cache: Stored | null = null

function dataDir(): string {
  return resolve(process.cwd(), process.env.DATA_DIR ?? 'data')
}

function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

function fromEnv(): Stored {
  const rawKind = (process.env.LLM_PROVIDER ?? 'deepseek').toLowerCase()
  const kind: ProviderKind = providerKindSchema.safeParse(rawKind).success
    ? (rawKind as ProviderKind)
    : 'deepseek'
  const preset = PROVIDER_PRESETS[kind]

  return {
    kind,
    baseUrl: (process.env.LLM_BASE_URL ?? preset.baseUrl).trim(),
    model: (process.env.LLM_MODEL ?? preset.model).trim(),
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    enabled: true,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
  }
}

function load(): Stored {
  const file = settingsFile()
  if (!existsSync(file)) return fromEnv()
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    if (!parsed.success) return fromEnv()
    // 文件里没填的字段仍然回落到环境变量，避免"改了一半全丢"
    const env = fromEnv()
    return {
      ...parsed.data,
      apiKey: parsed.data.apiKey || env.apiKey,
      timeoutMs: parsed.data.timeoutMs || env.timeoutMs,
    }
  } catch {
    return fromEnv()
  }
}

function ensure(): Stored {
  if (!cache) cache = load()
  return cache
}

function persist(value: Stored): void {
  mkdirSync(dataDir(), { recursive: true })
  const file = settingsFile()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/** 是否需要密钥才能算"可用" */
function requiresKey(kind: ProviderKind): boolean {
  return kind === 'deepseek'
}

export function getProvider(): ProviderSettings {
  const value = ensure()
  return {
    kind: value.kind,
    baseUrl: value.baseUrl.trim(),
    model: value.model.trim(),
    apiKey: value.apiKey,
    enabled: value.enabled,
  }
}

export function getTimeoutMs(): number {
  return ensure().timeoutMs
}

/** 没有可用接入时自动落回演示模式（回放内置样例） */
export function isDemo(): boolean {
  const provider = getProvider()
  if (!provider.enabled) return true
  if (!provider.baseUrl) return true
  if (requiresKey(provider.kind) && !provider.apiKey) return true
  return false
}

export function publicSettings(): PublicSettings {
  const provider = getProvider()
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    hasKey: provider.apiKey.length > 0,
    demo: isDemo(),
    timeoutMs: getTimeoutMs(),
  }
}

export interface SettingsPatch {
  kind?: ProviderKind
  baseUrl?: string
  model?: string
  apiKey?: string
  clearKey?: boolean
  enabled?: boolean
}

export function updateSettings(patch: SettingsPatch): PublicSettings {
  const current = ensure()
  const next: Stored = { ...current }

  if (patch.kind && patch.kind !== current.kind) {
    // 换接入方式时，把地址与模型带成该方式的预设，避免留着上一个服务的地址
    next.kind = patch.kind
    const preset = PROVIDER_PRESETS[patch.kind]
    if (!patch.baseUrl) next.baseUrl = preset.baseUrl
    if (!patch.model) next.model = preset.model
  } else if (patch.kind) {
    next.kind = patch.kind
  }

  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim()
  if (patch.model !== undefined) next.model = patch.model.trim()
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.clearKey) next.apiKey = ''
  else if (patch.apiKey !== undefined && patch.apiKey.trim().length > 0) next.apiKey = patch.apiKey.trim()

  cache = next
  persist(next)
  return publicSettings()
}

/** 测试连接时允许用"未保存"的临时配置 */
export function resolveProbe(input: {
  kind?: ProviderKind
  baseUrl?: string
  model?: string
  apiKey?: string
}): { kind: ProviderKind; baseUrl: string; model: string; apiKey: string } {
  const current = getProvider()
  return {
    kind: input.kind ?? current.kind,
    baseUrl: (input.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, ''),
    model: (input.model ?? current.model).trim(),
    apiKey: input.apiKey && input.apiKey.trim().length > 0 ? input.apiKey.trim() : current.apiKey,
  }
}
