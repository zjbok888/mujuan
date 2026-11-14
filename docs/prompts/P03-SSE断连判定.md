# P03 · SSE 刚发出第一个事件就中断：一次误判

| 项 | 内容 |
|---|---|
| 目标 | 用 SSE 把生成过程实时推给前端，且客户端断开时能止损 |
| 落点提交 | `f634f25` feat(api): Fastify 装配与 SSE 生成路由 |

## 1. 我给出的指令

> "生成接口要流式；客户端中途关掉页面时，服务端必须停止继续调用模型（省成本）。
> 每个流必须以 `done` 或 `error` 收尾。"

## 2. AI 的首版方案

```ts
reply.hijack()
res.writeHead(200, SSE_HEADERS)
const controller = new AbortController()
request.raw.on('close', () => {
  if (!res.writableEnded) controller.abort()
})
```

想法很自然：请求关了，就说明客户端走了。

## 3. 翻车与修正（真实发生）

本地冒烟测试，SSE 只吐了一个事件就报解析失败：

```
event: reasoning.delta
data: {"type":"reasoning.delta","text":"先读大纲……"}
event: error
data: {"type":"error","code":"PARSE","message":"无法从模型输出中解析 JSON："}
event: done
```

生成器在拿到第一个推理片段后立刻收到 abort，回放通道返回空串。

根因：Node 的 `IncomingMessage` 在**请求体读完**时就会触发 `close`，
它并不代表连接断开。POST 带 body 的请求几乎立刻就满足这个条件，
于是每一个生成请求都在开头被自己掐死。

修正：

```ts
// request.raw 的 close 在「请求体读完」时就会触发，用它检测断连会让流立刻自杀。
// 真正代表客户端断开的是响应端的 close，且以 writableEnded 区分正常结束。
res.on('close', () => {
  if (!res.writableEnded) controller.abort()
})
```

## 4. 复盘

这类 bug 的特征是"看起来完全合理"。如果只测 GET 请求或只测短请求，永远发现不了。
从此自检脚本里固定加了一条 **真实 POST 生成并断言事件序列** 的检查（`de879c1`）。
