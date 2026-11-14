# AGENTS.md · 墨卷工程宪法

> 这份文件是**给人看也是给 AI 看**的约束条款。每一次让 AI 改代码，都先把这份文件放进上下文。
> 它本身就是"参赛者如何约束 AI"的可审计物证。

## 1. 产品一句话

老师给一段"这节课教了什么"，墨卷产出**可编辑、可校验、可导出**的试卷；学生作答后系统确定性评分并产出学情。

## 2. 铁律（违反即回滚）

1. **AI 不得直接产出页面代码或业务逻辑**。模型输出只能是 `PaperIR`（JSON），由确定性渲染器执行。
2. **密钥只在服务端**。`web/` 目录下任何文件都不得出现 `sk-`、`DEEPSEEK_API_KEY`、模型 base URL。
3. **模型输出一律视为不可信数据**：必须经 zod 校验 + 业务规则校验 + 输出净化后才可落库或渲染。
4. **不改依赖方向**：`routes → domain → shared`；`infra` 由 `domain`/`routes` 注入；`domain` 不认识 Fastify；`shared` 不 import 任何实现。
5. **不新增原生依赖**（node-gyp / 预编译二进制）。新增任何依赖前先说明为什么内置能力不够。
6. **不留死循环**：任何 `while` 必须有显式上限；模型重试最多 2 轮。
7. **每次改动必须让 `npm run verify` 保持绿色**，不允许"先坏着，待会儿修"。

## 3. 目录职责

| 目录 | 职责 | 禁止 |
|---|---|---|
| `shared/` | zod schema、类型、SSE 契约、纯函数 | 引入网络/文件/框架依赖 |
| `server/domain/` | 生成、校验、评分、归一化（纯业务） | import fastify、读写库 |
| `server/infra/` | LLM 客户端、仓储、回放数据 | 包含业务规则 |
| `server/routes/` | HTTP 边界、参数校验、SSE 编码 | 写业务判断 |
| `web/` | 渲染与交互 | 任何密钥、任何直连模型 |
| `scripts/` | 开发/启动/自检 | 业务逻辑 |

## 4. 命名与风格

- TypeScript strict；禁止 `any`（确需时用 `unknown` + 收窄）。
- 文件名 `kebab-case`，导出的类型 `PascalCase`，函数 `camelCase`。
- 纯函数优先；有副作用的地方集中在 `infra/`。
- 注释写"为什么"，不写"是什么"。

## 5. 提交规范（比赛要求）

```
type(scope): 一句话摘要

- 为什么改
- 影响了什么

Prompt-ID: P03
Co-authored-by: AI
```

- 单次提交 50–400 行，用 `git add -p` 拆分，禁止一次性提交整个功能。
- 每个 `Prompt-ID` 必须在 `docs/prompts/` 有对应快照。

## 6. 完成定义（DoD）

一个任务只有同时满足才算完成：

1. `npm run typecheck` 通过；
2. `npm run verify` 通过；
3. 有对应提交 + Prompt 快照；
4. README 或文档无需修改，或已同步修改。
