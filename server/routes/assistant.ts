import type { FastifyInstance } from 'fastify'
import { assistantChatSchema, encodeAssistantSse } from '../../shared/assistant.js'
import { SSE_HEADERS } from '../../shared/events.js'
import { runAssistant } from '../domain/assistant.js'
import { LlmError } from '../infra/llm.js'
import { createRateLimiter } from '../infra/rate-limit.js'
import { isDemo } from '../settings.js'
import type { RouteDeps } from './papers.js'

export function registerAssistantRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const allow = createRateLimiter(20, 60_000)

  app.post('/api/assistant/chat', async (request, reply) => {
    const parsed = assistantChatSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: '对话内容不合法' })
    }
    if (!allow(request.ip)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', message: '助手请求过于频繁，请稍后再试' })
    }
    if (isDemo()) {
      return reply.code(409).send({
        error: 'DEMO_MODE',
        message: '当前是演示模式：AI 助手需要真实模型，请到「接入」里配置后再用。',
      })
    }

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, SSE_HEADERS)

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })

    const emit = (event: Parameters<typeof encodeAssistantSse>[0]): void => {
      if (!res.writableEnded) res.write(encodeAssistantSse(event))
    }

    try {
      await runAssistant({
        input: parsed.data,
        repo: deps.repo,
        llm: deps.makeLlmPort(controller.signal),
        emit,
        signal: controller.signal,
      })
    } catch (error) {
      const code = error instanceof LlmError ? error.code : 'INTERNAL'
      emit({ type: 'error', code, message: error instanceof Error ? error.message : '助手出错了' })
    } finally {
      emit({ type: 'done' })
      res.end()
    }
  })
}
