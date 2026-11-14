import type { ServerEvent } from '@shared/events'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 只在真的有 body 时才声明 application/json。
  // 否则 Fastify 会因为「声明了 JSON 却没有 body」直接 400（FST_ERR_CTP_EMPTY_JSON_BODY），
  // 这正是"发布/删除点了没反应"的根因。
  const hasBody = init?.body !== undefined && init?.body !== null
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `请求失败（${res.status}）`)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/**
 * 生成流：POST + ReadableStream（EventSource 只支持 GET，无法带 body）。
 * 返回 abort 函数，用于用户主动取消或组件卸载。
 */
export function streamGenerate(
  body: unknown,
  onEvent: (event: ServerEvent) => void,
  onError: (message: string) => void,
): () => void {
  const controller = new AbortController()

  void (async () => {
    try {
      const res = await fetch('/api/papers/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { message?: string } | null
        onError(detail?.message ?? `生成失败（${res.status}）`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              onEvent(JSON.parse(payload) as ServerEvent)
            } catch {
              // 半截帧或非 JSON 注释帧：忽略，等待下一帧
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return
      onError(error instanceof Error ? error.message : '网络异常')
    }
  })()

  return () => controller.abort()
}
