/**
 * AI 接入配置的共享契约。
 *
 * 关键约束：apiKey 永远不进入前端。服务端只回传 hasKey 布尔值，
 * 保存时若 apiKey 为 undefined 表示"沿用原值"，这样 UI 不需要把密钥读回来再写回去。
 */
import { z } from 'zod'

export const providerKindSchema = z.enum(['deepseek', 'ollama', 'lmstudio', 'custom'])
export type ProviderKind = z.infer<typeof providerKindSchema>

export interface ProviderPreset {
  label: string
  baseUrl: string
  model: string
  needsKey: boolean
  local: boolean
  hint: string
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek 云端',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    needsKey: true,
    local: false,
    hint: '需要 API Key；模型可选 deepseek-flash / deepseek-v4-pro',
  },
  ollama: {
    label: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
    local: true,
    hint: '先在本地运行 ollama serve，并 ollama pull 一个模型',
  },
  lmstudio: {
    label: 'LM Studio 本地',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-7b-instruct',
    needsKey: false,
    local: true,
    hint: '在 LM Studio 里开启 Local Server（OpenAI 兼容）',
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    needsKey: false,
    local: false,
    hint: '任何提供 /chat/completions 的服务，如 vLLM、llama.cpp server、公司内网网关',
  },
}

/** 服务端内部使用的完整配置（含密钥） */
export interface ProviderSettings {
  kind: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

/** 回传给前端的视图（脱敏） */
export interface PublicSettings {
  kind: ProviderKind
  baseUrl: string
  model: string
  enabled: boolean
  hasKey: boolean
  demo: boolean
  timeoutMs: number
}

export const updateSettingsSchema = z.object({
  kind: providerKindSchema.optional(),
  baseUrl: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
  /** undefined = 不改；空字符串配合 clearKey 才清空 */
  apiKey: z.string().max(300).optional(),
  clearKey: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>

export const probeSchema = z.object({
  kind: providerKindSchema.optional(),
  baseUrl: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(300).optional(),
})

export type ProbeInput = z.infer<typeof probeSchema>
