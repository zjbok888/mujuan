import type { FastifyInstance } from 'fastify'
import { PROVIDER_PRESETS, probeSchema, updateSettingsSchema } from '../../shared/settings.js'
import { createRateLimiter } from '../infra/rate-limit.js'
import { publicSettings, resolveProbe, updateSettings } from '../settings.js'

interface Endpoint {
  kind: string
  baseUrl: string
  model: string
  apiKey: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function friendly(error: unknown, baseUrl: string): string {
  const message = (error as Error)?.message ?? '未知错误'
  if (/ECONNREFUSED|fetch failed|Failed to fetch|ENOTFOUND/i.test(message)) {
    return `连不上 ${baseUrl}：请确认服务已启动、端口正确、地址带 /v1`
  }
  if (/abort|timeout/i.test(message)) {
    return '请求超时：本地模型首次加载可能较慢，可稍后重试'
  }
  return message
}

async function probeModels(endpoint: Endpoint): Promise<string[]> {
  if (!endpoint.baseUrl) throw new Error('请先填写接口地址')
  const res = await fetch(`${endpoint.baseUrl}/models`, {
    headers: authHeaders(endpoint.apiKey),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`/models 返回 ${res.status}`)
  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean)
}

async function probeChat(endpoint: Endpoint): Promise<{ latencyMs: number; preview: string }> {
  if (!endpoint.baseUrl) throw new Error('请先填写接口地址')
  if (!endpoint.model) throw new Error('请先填写模型名')
  const started = Date.now()
  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(endpoint.apiKey) },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      max_tokens: 16,
      stream: false,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`对话接口返回 ${res.status}：${text.slice(0, 160)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  return { latencyMs: Date.now() - started, preview: content.slice(0, 60) }
}

export function registerSettingsRoutes(app: FastifyInstance): void {
  const allowProbe = createRateLimiter(15, 60_000)

  app.get('/api/settings', async () => ({
    settings: publicSettings(),
    presets: PROVIDER_PRESETS,
  }))

  app.put('/api/settings', async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '配置不合法' })
    }
    return { settings: updateSettings(parsed.data) }
  })

  /** 拉取模型列表：本地服务（Ollama/LM Studio）普遍支持 /v1/models */
  app.post('/api/settings/models', async (request, reply) => {
    if (!allowProbe(request.ip)) {
      return reply.code(429).send({ ok: false, message: '操作过于频繁，请稍后再试' })
    }
    const parsed = probeSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: '参数不合法' })
    }
    const endpoint = resolveProbe(parsed.data)
    try {
      const models = await probeModels(endpoint)
      return { ok: true, models, message: models.length > 0 ? `发现 ${models.length} 个模型` : '接口可用，但未返回模型列表' }
    } catch (error) {
      return { ok: false, models: [], message: friendly(error, endpoint.baseUrl) }
    }
  })

  /** 真发一句话过去，确认能拿到回复（比 /models 更能证明可用） */
  app.post('/api/settings/test', async (request, reply) => {
    if (!allowProbe(request.ip)) {
      return reply.code(429).send({ ok: false, message: '操作过于频繁，请稍后再试' })
    }
    const parsed = probeSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: '参数不合法' })
    }
    const endpoint = resolveProbe(parsed.data)
    try {
      const result = await probeChat(endpoint)
      return {
        ok: true,
        latencyMs: result.latencyMs,
        message: `连接正常（${result.latencyMs}ms）`,
        preview: result.preview,
      }
    } catch (error) {
      return { ok: false, message: friendly(error, endpoint.baseUrl) }
    }
  })
}
