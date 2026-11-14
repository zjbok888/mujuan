# P01 · 把"AI 能产出什么"收进一份契约（QuizIR v1）

| 项 | 内容 |
|---|---|
| 目标 | 让模型只产出结构化试卷，不产出页面代码 |
| 落点提交 | `e3e3eec` feat(shared): 定义 QuizIR v1 与 SSE 事件契约 |
| 关联提交 | `4b51659`（评分结果类型下沉到 shared） |

## 1. 我给出的指令（关键约束）

> "AI 不得直接产出页面代码或业务逻辑。模型输出只能是 PaperIR（JSON），由确定性渲染器执行。
> 结构由 zod 在服务端强制校验，前后端共用同一份 schema。"

配套要求：

- 一份 `paperSchema` 同时被服务端校验、前端类型推导使用；
- 事件协议必须自带结束语义（`done` / `error`），否则前端会永久转圈；
- 评分结果的类型也要下沉，前端不能自己再猜一遍"这题算对算错"。

## 2. AI 的首版方案

一次给出 `shared/ir.ts`：`questionSchema` / `sectionSchema` / `blueprintSchema` / `paperSchema`，
字段完整、类型收敛，看起来没问题。当时我在 `answers` 上加了 `max(300)`，
在 `keywordRubric` 上加了 `max(10)`——理由是"防止模型话痨"。

## 3. 翻车与修正（真实发生）

第一次用真实模型跑通生成后，演示数据加载直接抛错：

```
Too big: expected string to have <=300 characters
  path: ["sections", 0, "questions", 6, "answers", 0]
Too big: expected array to have <=10 items
  path: ["sections", 0, "questions", 6, "keywordRubric"]
```

简答题的参考答案是完整解题过程（600+ 字），评分细则是 16 条要点。
**是我把 schema 的边界定错了**，不是模型错了。

修正思路不是简单调大数字，而是分清两层：

- **结构上限**放宽到"人类真会写出来的规模"（2000 字符 / 20 条）；
- **业务规则**（细则分值和等于题目分值、答案必须在选项内）交给 `validator.ts`，
  用可读的中文错误信息回报，而不是让 zod 抛出一堆 `too_big`。

## 4. 复盘

这条约束后来反复救命：模型每次输出都先过 zod（结构），再过 validator（业务），
任何一层不过都不会进入数据库。**"不可信数据"这个假设写在 schema 里，而不是写在注释里。**
