# Agent 内核一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 chat 的单轮工具调用升级为可观测、可规划、健壮的 Agent 内核（任务清单 + 轮次化循环 + 超时/重试/续跑）。

**Architecture:** `llm.ts` 的 `streamChat` 工具循环升级为 8+1 轮显式 Agent Loop（run/plan 事件推送），新工具 `todo_write` 读写 `agent_todos` 表（按 thread）实现人机共写任务清单；执行器包一层分类超时/重试；模型调用加退避重试与断流续跑；ChatPanel 时间线按 callId 匹配并新增可编辑任务面板。

**Tech Stack:** Next.js 15 / TypeScript / better-sqlite3 / OpenAI 兼容 SSE。验证基建：`npx tsc --noEmit` + `node scripts/verify-*.mjs`（Node ≥22.6 原生 TS，纯函数脚本，沿 `verify-revproxy-fn.mjs` 惯例）+ `npm run build`。

**Spec:** `docs/superpowers/specs/2026-11-10-agent-core-phase1-design.md`

**命名对齐（规格偏差，按仓库现状执行）：** 规格 §3.1 的 `conversation_id` 改为 `thread_id`（仓库 `threads`/`messages` 表均用 `thread_id`，对话实体是 thread）。

## Global Constraints

- 零回归（规格 G4）：单轮问答、引用标注、7 个资料库工具、mock 模式、"上游不支持 tools 则去 tools 重试"的降级路径全部保持原行为。
- 不新增 npm 依赖；TypeScript strict 通过 `npx tsc --noEmit`。
- 轮次预算：`IFCOPE_AGENT_MAX_ROUNDS` 环境变量，缺省 `8`（8 轮带工具 + 1 轮强制文字收尾）。
- 工具调用总数护栏 16；同名同参数连续 3 次触发护栏提示。
- 工具超时（规格 §3.3）：只读 list_library/read_source 15s、web_search 30s（失败重试 1 次）；写操作 move_source/move_artifact/create_category/todo_write 10s（不重试）；generate_summary 120s（不重试）。
- 模型调用重试：429/5xx/网络错误退避 2 次（1s、3s）；4xx（非 429）不重试。
- 断流续跑最多 2 次，计入轮次预算。
- `todo_write` 每次传完整清单幂等覆盖（事务先删后插）；同一时刻清单最多一个 `in_progress`（提示词规则，非硬校验）。
- UI 文案中文；事件协议向后兼容（旧字段不动，新增可选字段）。

## Review Focus

1. **同轮多工具并发时时间线错乱** — 旧 `mergeTool` 按 name 匹配，同名并发串行错位 → Task 2 的 `verify-agent-core.mjs` 断言同名两条 callId 独立合并。
2. **用户在面板手改清单后模型不感知** — 必须每轮从表读最新清单注入提示词（不是首快照）→ Task 4 实现"每轮重建 messages[0]"，Task 6 手动验收"让它复述清单"。
3. **断流续跑重复执行已完成的工具调用** — 续跑提示词明示"不要重复已完成的动作" + 重复调用护栏（Task 5），手动验收断网重连场景。
4. **上游不支持 function calling 的模型**（400/422 去 tools 降级）零回归 → Task 4 保留原降级分支，手动验收（或 mock 上游）。
5. **SSE 消费者对新增事件字段的健壮性** — 旧消费者忽略未知字段即可；ChatPanel 对 `plan`/`run` 缺失要不崩（mock 模式无这些事件）→ Task 6 手动验收 mock 模式。

---

### Task 1: 任务清单存储与 API（`agent_todos` 表）

**Files:**
- Modify: `src/lib/db.ts`（CREATE TABLE 块追加，约 :8-130 一带）
- Create: `src/lib/agent/todo.ts`
- Create: `src/app/api/agent/todos/route.ts`

**Interfaces:**
- Consumes: `db`（`src/lib/db.ts` 默认导出，better-sqlite3 实例）、NextRequest/NextResponse 惯例（参照 `src/app/api/classroom/courses/route.ts`）
- Produces（后续任务依赖，签名精确）:
  - `type TodoItem = { id: number; text: string; status: "pending" | "in_progress" | "completed" }`（导出自 `src/lib/agent/todo.ts`）
  - `getTodos(threadId: number): TodoItem[]`（按 item_id 升序）
  - `replaceTodos(threadId: number, items: TodoItem[]): void`（事务先删后插，幂等覆盖）
  - HTTP `GET /api/agent/todos?threadId=<n>` → `{ todos: TodoItem[] }`；`PUT /api/agent/todos` body `{ threadId: number, todos: TodoItem[] }` → `{ ok: true }`

- [ ] **Step 1: 在 `src/lib/db.ts` 的 CREATE TABLE 块末尾追加 `agent_todos` 表**

```sql
CREATE TABLE IF NOT EXISTS agent_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL
);
```

（与既有表同样风格；`item_id` 即 TodoItem.id，保留自增主键便于未来扩展。）

- [ ] **Step 2: 创建 `src/lib/agent/todo.ts`**，实现上面 Interfaces 中的 `TodoItem`/`getTodos`/`replaceTodos`。`replaceTodos` 在 `db.transaction` 内先 `DELETE FROM agent_todos WHERE thread_id = ?` 后逐条 INSERT（item_id/text/status/updated_at=Date.now()）；status 三态之外的值按 `"pending"` 落库。

- [ ] **Step 3: 创建 `src/app/api/agent/todos/route.ts`**（`export const runtime = "nodejs"`）：GET 读 `threadId` 查询参数（非法/缺失回 400 `{ error }`）返回 `{ todos }`；PUT 解析 body 调 `replaceTodos` 返回 `{ ok: true }`，body 非法回 400。

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无输出（通过）

- [ ] **Step 5: 手动冒烟（dev server 运行时）**

Run: `curl -X PUT http://localhost:3777/api/agent/todos -H "Content-Type: application/json" -d '{"threadId":-1,"todos":[{"id":1,"text":"t","status":"pending"}]}'` 然后 `curl "http://localhost:3777/api/agent/todos?threadId=-1"`
Expected: PUT 回 `{"ok":true}`；GET 回 1 条 "t"

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/agent/todo.ts src/app/api/agent/todos/route.ts
git commit -m "feat(agent): agent_todos 表 + 任务清单存储与 API"
```

### Task 2: 纯函数底座：时间线合并 / 超时 / 循环护栏（TDD）

**Files:**
- Create: `src/lib/agent/timeline.ts`（仅 `import type`，运行时零依赖）
- Create: `src/lib/agent/timeout.ts`（纯函数）
- Create: `src/lib/agent/loopGuards.ts`（纯类）
- Create: `scripts/verify-agent-core.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `src/lib/agent/timeline.ts`：
    `type ToolPhase = "run" | "done" | "error";`
    `type LiveTool = { callId?: string; name: string; round: number; intent?: string; phase: ToolPhase; detail?: string };`
    `mergeTool(list: LiveTool[], ev: ToolEvent): LiveTool[]`（`ToolEvent` 用 `import type` 自 `../llm.ts` 引入；phase 映射 `"start" → "run"`；有 `callId` 按 callId 匹配替换，无 `callId` 的旧事件（如 route.ts 手工发的 web_search）按 name 匹配首个 run 态条目兜底，找不到则追加；纯函数不改入参）
  - `src/lib/agent/timeout.ts`：`withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>`（超时 reject `Error(\`${label} 超时（${ms}ms）\`)`，Promise.race 实现，超时后原 promise 丢弃）
  - `src/lib/agent/loopGuards.ts`：`class LoopGuard { constructor(maxToolCalls = 16); record(name: string, argsJson: string): string | null }`——同名同 argsJson 连续第 3 次返回"检测到重复调用（<name>），请换策略或停止"；累计调用超 16 次返回"工具调用预算已用尽，请立即收敛并总结"；其余返回 null（提示后清零对应计数，避免刷屏）

- [ ] **Step 1: 写失败验证脚本 `scripts/verify-agent-core.mjs`**（`import assert from "node:assert/strict"`，import 路径带 `.ts` 扩展名，参照 `scripts/verify-revproxy-fn.mjs`）。断言（用例名即注释）：
  1. `withTimeout`：10ms 内 resolve 的 promise 原值返回；`withTimeout(new Promise(()=>{}), 5, "x")` reject 且 message 含"超时"；
  2. `mergeTool`：同名两条 `{callId:"a1",name:"read_source",phase:"run"}`/`{callId:"a2",name:"read_source",phase:"run"}` 并存；对 `"a2"` 的 done 事件只更新第二条；`"start"` 事件入表后 phase 为 `"run"`；无 callId 的 done 事件按 name 兜底更新首个 run 态条目；未知 callId 的 done 事件追加为独立条目；入参数组不被修改；
  3. `LoopGuard`：同参调用前 2 次返回 null、第 3 次返回含"重复调用"的提示；连续调用 17 次中第 17 次返回含"预算"的提示；不同参数不触发重复计数。

- [ ] **Step 2: 运行验证确认失败**

Run: `node scripts/verify-agent-core.mjs`
Expected: FAIL（模块不存在 / assert 失败）

- [ ] **Step 3: 实现三个模块**（`timeline.ts` 的 `mergeTool` 用 map 复制替换；`timeout.ts` 注意 clearTimeout 防泄漏；`loopGuards.ts` 内部 `Map<string, number>` 记连续次数 + `count` 记总数）

- [ ] **Step 4: 运行验证确认通过**

Run: `node scripts/verify-agent-core.mjs`
Expected: 无输出即通过（assert 全过）；再跑 `npx tsc --noEmit` 无输出

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-agent-core.mjs src/lib/agent/timeline.ts src/lib/agent/timeout.ts src/lib/agent/loopGuards.ts
git commit -m "feat(agent): 时间线合并/超时/循环护栏纯函数底座"
```

### Task 3: `todo_write` 工具 + 执行器策略层 + 系统提示词升级

**Files:**
- Modify: `src/lib/agent/tools.ts`（TOOLS 数组 + `executeTool` 签名与 case）
- Create: `src/lib/agent/executor.ts`
- Modify: `src/lib/agent/system.ts`

**Interfaces:**
- Consumes: Task 1 的 `TodoItem`/`getTodos`/`replaceTodos`；Task 2 的 `withTimeout`
- Produces:
  - `executeTool(call: ToolCall, ctx: ToolContext): Promise<string>`（签名变更：新增 ctx；`type ToolContext = { threadId: number }` 导出自 `tools.ts`）
  - `runTool(call: ToolCall, ctx: ToolContext): Promise<string>`（导出自 `executor.ts`：按 `TOOL_POLICY` 分类超时；只读工具失败/超时自动重试 1 次；写操作不重试。失败 throw，由调用方转错误文本回喂）
  - `buildSystemPrompt(selectedSourceIds: number[], todos: TodoItem[] = []): string`（签名变更：新增 todos 参数）

- [ ] **Step 1: `tools.ts`：`executeTool` 加 `ctx: ToolContext` 参数**，新增 `todo_write` 工具定义与 case：
  - 参数 schema：`todos: { type: "array", items: { type: "object", properties: { id:{type:"integer"}, text:{type:"string"}, status:{type:"string", enum:["pending","in_progress","completed"]} }, required:["id","text","status"] } }`
  - 描述：`更新当前对话的任务清单（传入完整清单，幂等覆盖）。多步骤任务开始时先拆解清单，执行中实时更新状态`
  - case 体：校验数组 → `replaceTodos(ctx.threadId, items)` → 返回 `已更新任务清单：N 项（进行中 X / 完成 Y）`
  - 其余 7 个 case 不改逻辑（仅受签名变更影响）。

- [ ] **Step 2: 创建 `src/lib/agent/executor.ts`**：`TOOL_POLICY: Record<string, { timeoutMs: number; retry: boolean }>`（值按 Global Constraints）；`runTool` 对未知工具名走默认 10s/不重试；重试仅在首次 throw 时执行一次。

- [ ] **Step 3: `system.ts` 升级**：
  - `listToolsText()` 改为遍历 `TOOLS` 注册表生成（`import { TOOLS } from "./tools"`，输出 `${name} — ${description}` 行），防清单漂移；
  - 新增 `<agent_loop>` 段（Manus 节选语义：每轮一个工具调用→观察结果→更新任务→迭代→最后总结；"每轮只做一步，做完看结果再决定下一步"）与 `<task_management>` 段（Trae 规则：三态、单 in_progress、完成立即标记、失败保持 in_progress 并新建阻塞任务、永不虚标、单一直接小任务不必用 todo、拿不准就用）；
  - 新增输出纪律：工具调用前用一句话说明意图；最终回答前核对清单全部完成；
  - 新增 `<current_todos>` 注入：todos 非空时输出清单现状（含用户手动改过的），空则输出"（无任务清单）"。

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit`
Expected: 无输出。`streamChat` 尚未传 ctx，此步 tsc 会报 `executeTool` 调用处缺参——因此**本任务与 Task 4 之间允许 tsc 红**：把 llm.ts 调用处临时改为 `executeTool(call, { threadId: 0 })` 占位（Task 4 替换为真实 threadId），保证本任务结束时 tsc 绿。

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools.ts src/lib/agent/executor.ts src/lib/agent/system.ts src/lib/llm.ts
git commit -m "feat(agent): todo_write 工具 + 执行器分类超时 + 提示词 agent_loop/task_management"
```

### Task 4: G2 Agent Loop 显式化（事件协议 + 轮次 + 每轮清单注入 + 护栏接入）

**Files:**
- Modify: `src/lib/llm.ts`（`ChatEvent`/`ToolEvent` 类型、`streamChat` 循环、`streamOnce` 不变）
- Modify: `src/app/api/chat/route.ts`（事件转发）

**Interfaces:**
- Consumes: Task 2 的 `LoopGuard`/`mergeTool` 类型（`ToolEvent` 字段扩展后 `timeline.ts` 的 import type 自动对齐）；Task 3 的 `runTool`/`getTodos`/`buildSystemPrompt(…, todos)`
- Produces:
  - `ToolEvent` 扩展为 `{ callId?: string; name: string; phase: "start" | "done" | "error"; detail?: string; round: number; intent?: string }`（callId 可选：兼容 route.ts 手工事件；round 对手工事件允许 0）
  - `ChatEvent` 扩展为 `{ delta?: string; reasoning?: string; tool?: ToolEvent; plan?: { todos: TodoItem[] }; run?: { round: number; maxRounds: number; intent?: string } }`
  - `streamChat(question: string, contextBlocks: string[], history: ChatMessage[], sourceIds: number[] = [], threadId: number)`（签名变更：新增 threadId，route.ts 传真实值）

- [ ] **Step 1: 类型扩展**（按 Produces；`TodoItem` 以 `import type` 自 `./agent/todo` 引入）

- [ ] **Step 2: 循环改造**（`streamChat` 主体）：
  - `const maxRounds = Number(process.env.IFCOPE_AGENT_MAX_ROUNDS ?? 8)`；带工具轮 `round < maxRounds`，末轮强制纯文字（保留现"最后一轮不带工具"逻辑）；
  - 每轮开始：`messages[0] = { role: "system", content: buildSystemPrompt(sourceIds, getTodos(threadId)) }`（每轮从表读**最新**清单）；emit `run: { round, maxRounds, intent }`（intent 取该轮 content 首个非空行、单行化、截 80 字符，工具调用前的流式文本累积后提取；无文本则 undefined）；
  - 工具执行改调 `runTool(call, { threadId })`，`ToolEvent` 带生成的 `callId`（`call_${round}_${index}`）、`round`、`intent`；失败错误文本回喂保持现状；
  - `todo_write` 成功后 emit `plan: { todos: getTodos(threadId) }`；
  - `LoopGuard.record` 返回非 null 时，把提示文本追加进该轮 tool 结果回喂（前缀 `【护栏】`）；
  - 末轮前若 `round === maxRounds - 1`，向 messages 追加 user 消息"轮次预算即将用尽，请收敛任务并给出总结"。

- [ ] **Step 3: `route.ts` 转发**：`streamChat(..., threadId)`；SSE `send` 处新增 `if (part.plan) send({ plan: part.plan })`、`if (part.run) send({ run: part.run })`（现有 delta/reasoning/tool 转发不动）。

- [ ] **Step 4: 验证**：`npx tsc --noEmit` 无输出；`node scripts/verify-agent-core.mjs` 仍通过。

- [ ] **Step 5: 手动验收**（dev server + 已配模型）：提问"帮我整理资料库：建一个'数学'类目并把 XX 移进去，然后复述你的任务清单"——预期：任务面板出现清单（下一任务接 UI 前可先看 SSE 流里 `plan` 事件）、工具逐项执行、最终复述含用户后续手改内容（Task 6 后验收）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts src/app/api/chat/route.ts
git commit -m "feat(agent): Agent Loop 显式化——run/plan 事件、轮次化、每轮清单注入、护栏接入"
```

### Task 5: G3 健壮性（模型重试 + 断流续跑 + 预算护栏收口）

**Files:**
- Modify: `src/lib/llm.ts`（`streamOnce` 的 fetch、`streamChat` 循环的异常路径）

**Interfaces:**
- Consumes: Task 4 的循环结构
- Produces: 无新导出（行为增强）

- [ ] **Step 1: fetch 退避重试**：`streamOnce` 内首次 fetch 包一层——`429/5xx/网络错误`（fetch reject 或 !res.ok 且 status 符合）重试 2 次，延迟 1s、3s；4xx（非 429）直接 throw 现有错误文本；原"400/422 去 tools 降级重试"分支保留且不计入退避次数。

- [ ] **Step 2: 断流续跑**：`streamChat` 的每轮迭代包 try/catch——迭代中途 throw 且该轮已产出部分 `answerText` 时：把已产出文本作为 `assistant` 消息回喂，追加 user 消息"（此前输出被网络中断，请从断点继续剩余部分，不要重复已完成的动作）"，续跑一轮（计入轮次预算），最多续跑 2 次；仍失败则保留已产出内容 + emit `delta: "\n\n（连接中断，回复不完整，可让我继续）"`，不再 throw。

- [ ] **Step 3: 预算护栏收口**：确认 LoopGuard 16 上限与重复 3 次护栏在续跑路径下计数不重置；`recordUsage` 照旧累计（重试轮的 usage 也计入）。

- [ ] **Step 4: 验证**：`npx tsc --noEmit` 无输出；`node scripts/verify-agent-core.mjs` 通过。

- [ ] **Step 5: 手动验收**：模型调用中拔网 5 秒再插回——预期不整条报废（续跑或明确中断提示）；上游返回 429（可用 mock/代理模拟）时自动退避重试。

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts
git commit -m "feat(agent): 模型调用退避重试 + 断流续跑 + 护栏预算收口"
```

### Task 6: 前端任务面板 + 时间线升级 + 全量回归

**Files:**
- Modify: `src/components/ChatPanel.tsx`（`mergeTool` 移除改用 `timeline.ts`；live 状态、时间线渲染、任务面板组件）

**Interfaces:**
- Consumes: Task 2 的 `mergeTool`/`LiveTool`（`timeline.ts`）；Task 4 的 `plan`/`run` 事件；Task 1 的 `PUT /api/agent/todos` API 与 `TodoItem`
- Produces: 无后继任务

- [ ] **Step 1: 时间线升级**：删除 ChatPanel 本地 `mergeTool`/`LiveTool`，改 `import { mergeTool, type LiveTool } from "@/lib/agent/timeline"`；live 状态加 `plan: TodoItem[]`、`run?: { round: number; maxRounds: number; intent?: string }`；SSE 事件处理补 `evt.plan`/`evt.run` 分支；时间线条目渲染为 `[第{round}轮] {⏳|✅|❌} {name} — {intent}`（intent 缺省不显示破折号段；无 callId 的旧事件按 name 兜底匹配不崩）。

- [ ] **Step 2: 任务面板**（对话区上方）：`plan` 为空不渲染；收起态 `☑ {completed}/{total}` 徽标可点击展开；展开列表每项：状态图标点击循环切换三态、文本双击进入编辑（Enter/失焦保存、Esc 取消）、✕ 删除条目；任何改动乐观更新本地 `plan` 并 `PUT /api/agent/todos`（body `{ threadId, todos }`）；失败回滚并提示。

- [ ] **Step 3: 全量回归验证**

Run: `npx tsc --noEmit` → 无输出；`node scripts/verify-agent-core.mjs` → 通过；`node scripts/verify-revproxy-fn.mjs` → 通过；`npm run build` → 成功（跑前确认 dev server 未占 `.next`，或用 tsc 替代并在验收单注明）

- [ ] **Step 4: 手动验收清单**（规格 §7 逐条）：
  1. 多步骤任务先出清单、逐项执行、实时更新状态、最终核对完成；
  2. 面板手改状态/文本后，下轮模型复述清单能感知（Review Focus #2）；
  3. 时间线按轮次显示含意图，同名工具并发不错乱（Review Focus #1）；
  4. mock/未配置模型模式无 plan/run 事件不崩（Review Focus #5）；
  5. 单轮纯问答、引用标注、7 个资料库工具行为与改造前一致（G4）；
  6. 同参数重复调用 3 次出现【护栏】提示。

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatPanel.tsx
git commit -m "feat(agent): 任务面板（人机共写清单）+ 时间线轮次/意图展示"
```
