# Agent 二期 · 个性化与上下文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户级指令/偏好记忆 + 5 场景 Prompt 可配置 + 历史分层截断 + 用量展示（个性化与上下文）。

**Architecture:** 新增 `user_prefs`/`prompt_overrides` 两表与 `prefs.ts`/`prompts.ts` 存储模块；LLM 场景统一经 `resolvePrompt()` 取提示词、注入 `<user_profile>`（用户指令+偏好）；chat Agent 新增 3 个偏好工具；历史经 `foldHistory()` 按 token 预算折叠；设置页新增「个性化」Tab 消费新 API。

**Tech Stack:** Next.js 15 / TypeScript / better-sqlite3 / verify 脚本（`node scripts/verify-*.mjs`，裸 Node 跑纯逻辑）+ `npx tsc --noEmit`。

**Spec:** `docs/superpowers/specs/2026-11-10-agent-phase2-personalization-design.md`

**命名与规格偏差（按代码现状执行）：** `usage_ledger` 的列是 `action`（非 feature）；历史折叠预算因拿不到模型上下文长度，`foldHistory` 以固定默认 4000 tokens 为上限（规格的 ×0.25 公式退化为常量，参数可传）。

## Global Constraints

- 零回归：一期 Agent Loop/任务面板/8 个工具/引用标注/mock 模式不变；5 处提示词默认文案**逐字保留**（挪进 `PROMPT_DEFAULTS` 常量，文本不改）。
- 不新增 npm 依赖；`npx tsc --noEmit` 通过。
- 偏好上限 50 条（`PREFS_MAX`）；`<user_profile>` 注入区截断 2000 字符。
- `foldHistory(history, budgetTokens = 4000)`：保留最近 2 条完整；超预算的最老连续段折叠为一条 `role:"system"` 占位（含条数与首条用户内容前 40 字）；总预算内**原样返回**（短对话零变化）。
- `resolvePrompt(key, fallback)`：无覆盖行或覆盖为空串 → 返回 `fallback`（空串=清除覆盖）。
- `save_pref` 幂等：同文本已存在则不重复插入。
- chat 只开放 `chat_append` 追加（动态骨架不可覆盖）；UI 文案中文。

## Review Focus

1. **history 折叠产生孤儿消息** — DB 历史只含 user/assistant 文本消息（无 tool 消息），折叠不得破坏 user/assistant 顺序语义 → Task 4 verify 断言折叠输出角色序列合法、最近 2 条完整。
2. **偏好幂等与上限** — 同文本重复 save 不得重复；第 51 条应被拒并提示 → Task 1 verify 断言幂等；Task 2 工具返回文本含上限提示。
3. **chat_append/user_profile 叠加顺序影响遵循度** — 注入顺序：默认骨架 → `<user_profile>` → `chat_append` → `<current_todos>`；手动验收观察模型是否遵循指令（Task 7）。
4. **覆盖提示词为纯空格/空串的语义** — `setPromptOverride(key, "  ")` 应视为清除（trim 后空串），resolvePrompt 回默认 → Task 1 verify 断言。
5. **用量聚合与 ledger 一致性** — `action` 列聚合数字须与手工 COUNT/SUM 一致 → Task 5 curl 冒烟对比。

---

### Task 1: 存储层（2 表 + prefs/prompts 模块 + verify）

**Files:**
- Modify: `src/lib/db.ts`（CREATE TABLE 块 + `ModelSettings.userDirective?`）
- Create: `src/lib/agent/prefs.ts`
- Create: `src/lib/prompts.ts`
- Create: `scripts/verify-personal-store.mjs`

**Interfaces:**
- Consumes: `db`（默认导出）
- Produces:
  - `src/lib/agent/prefs.ts`：`type UserPref = { id: number; text: string }`；`PREFS_MAX = 50`；`listPrefs(): UserPref[]`（id 升序）；`savePref(text: string): { id: number; created: boolean }`（trim 后空文本 throw；同文本已存在返回 `{ id, created: false }`）；`deletePref(id: number): boolean`；`buildUserSection(userDirective: string, prefs: UserPref[]): string`（返回 `<user_profile>…</user_profile>` 文本；指令与偏好都空时返回 ""；拼好后整体截 2000 字符）
  - `src/lib/prompts.ts`：`type PromptKey = "chat_append" | "ask_system" | "artifact_summary" | "map_router" | "map_rel"`；`PROMPT_DEFAULTS: Record<PromptKey, string>`（`ask_system`/`map_router`/`map_rel`/`artifact_summary` 的文本**逐字**取自 `api/ask/route.ts` 的 `SYSTEM`/`ROUTER_SYSTEM`/`REL_SYSTEM` 与 `lib/artifact.ts` 的 `SYSTEM`，搬入此后原文件改引用；`chat_append` 默认 `""`）；`resolvePrompt(key: PromptKey, fallback: string): string`；`getPromptOverride(key): string | null`；`setPromptOverride(key: PromptKey, content: string): void`（trim 后空串 = DELETE 行）

- [ ] **Step 1: `db.ts` 追加 2 表 + 字段**

```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_overrides (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`ModelSettings` 增加 `userDirective?: string`（EMPTY 不加键，getSettings 的 JSON 合并天然兼容）。

- [ ] **Step 2: 写失败验证 `scripts/verify-personal-store.mjs`**（哨兵数据用 `text` 前缀 `__test__` 清理）：断言——`savePref("__test__a")` 二次调用 `created:false` 且 `listPrefs()` 中仅 1 条；`deletePref` 返回 true/false；`buildUserSection` 指令+偏好非空时含 `<user_profile>` 与两条文本，全空返回 ""，超 2000 字符被截断；`setPromptOverride("__k__", "  ")` 后 `getPromptOverride("__k__")` 为 null（清除语义）；`resolvePrompt` 无覆盖回 fallback、有覆盖回覆盖值。

- [ ] **Step 3: 运行确认 FAIL**（模块不存在）

Run: `node scripts/verify-personal-store.mjs` → Expected: ERR_MODULE_NOT_FOUND

- [ ] **Step 4: 实现 `prefs.ts`/`prompts.ts`**（db 沿用 `import db from "../db.ts"` 相对扩展名惯例；`buildUserSection` 先拼后截）；`PROMPT_DEFAULTS` 的 4 个默认文案从 `ask/route.ts`/`artifact.ts` **逐字复制**进来（原位置暂不动，容忍一个提交周期的重复——Task 3 删原件改引用）。

- [ ] **Step 5: 运行确认 PASS + tsc**

Run: `node scripts/verify-personal-store.mjs` → `verify-personal-store: all pass`；`npx tsc --noEmit` → 无输出

- [ ] **Step 6: Commit** `feat(agent): 个性化存储层——user_prefs/prompt_overrides + prefs/prompts 模块`

### Task 2: 偏好工具 + `<user_profile>` 注入

**Files:**
- Modify: `src/lib/agent/tools.ts`、`src/lib/agent/executor.ts`、`src/lib/agent/system.ts`、`src/lib/llm.ts`

**Interfaces:**
- Consumes: Task 1 的 `listPrefs/savePref/deletePref/buildUserSection`、一期的 `ToolContext`/`runTool`/`TodoItem`
- Produces:
  - tools.ts 新增 3 工具：`save_preference{text: string}`、`list_preferences{}`、`delete_preference{id: integer}`（描述见规格 §3.2；执行结果含上限提示：`countPrefs() >= PREFS_MAX` 时 save 返回失败文本不插入）
  - `buildSystemPrompt(selectedSourceIds: number[], todos: TodoItem[] = [], userSection: string = "")`（签名再扩展；`userSection` 非空时插在 `<agent_loop>` 之前）
  - llm.ts：每轮 `messages[0]` 组装改为 `buildSystemPrompt(sourceIds, getTodos(threadId), buildUserSection(s.userDirective ?? "", listPrefs()))`

- [ ] **Step 1: tools.ts/executor.ts 加 3 工具**（save 10s 不重试；list/delete 同只读 15s 重试——`list_preferences` retry:true，`delete_preference` 写操作 retry:false）

- [ ] **Step 2: system.ts 加 `userSection` 参数**（位置：`<agent_loop>` 之前）；提示词 `<task_management>` 后追加偏好规则（明确要求才存/存前复述/上限 50）

- [ ] **Step 3: llm.ts 接线**（`getTodos` 同侧调用 `listPrefs()`；`s.userDirective` 从 getSettings 取）

- [ ] **Step 4: 验证**：`npx tsc --noEmit` 无输出；`node scripts/verify-personal-store.mjs` 与 `node scripts/verify-agent-core.mjs` 通过

- [ ] **Step 5: 手动冒烟**（dev server）：curl POST /api/chat 多步骤问题含"记住：回答用一句话"→ SSE 中 `save_preference` 工具事件出现，`GET /api/prefs?`…（Task 5 提供）暂用 node 查 `user_prefs` 表验证落库

- [ ] **Step 6: Commit** `feat(agent): 偏好工具 save/list/delete_preference + user_profile 注入`

### Task 3: Prompt 覆盖接线（ask/artifact/chat_append）

**Files:**
- Modify: `src/app/api/ask/route.ts`、`src/lib/artifact.ts`、`src/lib/agent/system.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolvePrompt`/`PROMPT_DEFAULTS`
- Produces: 无新导出（行为可配置化）

- [ ] **Step 1: `ask/route.ts`** 删本地 `SYSTEM`/`ROUTER_SYSTEM`/`REL_SYSTEM` 常量定义（文本已在 Task 1 的 `PROMPT_DEFAULTS`），调用点改 `resolvePrompt("ask_system", PROMPT_DEFAULTS.ask_system)` 等（messages 组装处）；**文本不得变**（以 verify 断言为准）。

- [ ] **Step 2: `artifact.ts`** 同理改 `resolvePrompt("artifact_summary", …)`。

- [ ] **Step 3: `system.ts`** 末尾（`<current_todos>` 之后）追加 `resolvePrompt("chat_append", "")`（空则不加）。

- [ ] **Step 4: 验证**：tsc + 两个 verify 脚本通过；node 一行脚本断言 `resolvePrompt("ask_system", …)` 默认值与原 SYSTEM 字符串一致（可放 verify-personal-store 补断言）。

- [ ] **Step 5: Commit** `feat(agent): 5 场景提示词可配置（resolvePrompt 接线）`

### Task 4: 历史分层截断 `foldHistory`（TDD）

**Files:**
- Create: `src/lib/agent/context.ts`
- Modify: `src/lib/llm.ts`
- Create: `scripts/verify-context-fold.mjs`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `foldHistory<T extends { role: string; content: string }>(history: T[], budgetTokens = 4000): T[]`（导出自 `context.ts`；估算用字符数/3 近似 token，与 `estimateTokens` 同思路但零依赖——纯模块裸跑）

- [ ] **Step 1: 写失败验证 `scripts/verify-context-fold.mjs`**：短历史（预算内）原样返回（引用相等或深相等）；长历史：最近 2 条完整保留、折叠占位为 `role:"system"` 且 content 含"已省略"与首条被折用户内容前 40 字、输出角色序列无连续 system、总长显著缩短；单条超预算时只折旧的不动新的。

- [ ] **Step 2: 运行确认 FAIL** → **Step 3: 实现 `context.ts`**（从旧到新累加估算；超出即确定折叠边界；折叠段 1 条占位 + 未折段原样）→ **Step 4: 运行 PASS + tsc**

- [ ] **Step 5: llm.ts 接线**：`history.slice(-8)` 替换为 `foldHistory(history)`（保留 slice 上限语义：先 slice(-20) 防超大历史再 fold）。

- [ ] **Step 6: Commit** `feat(agent): 历史分层截断 foldHistory（token 预算内折叠旧行）`

### Task 5: API 路由（prompts / prefs / usage / settings 扩展）

**Files:**
- Create: `src/app/api/prompts/route.ts`、`src/app/api/prefs/route.ts`、`src/app/api/usage/summary/route.ts`
- Modify: `src/app/api/settings/route.ts`（`userDirective` 透传）

**Interfaces:**
- Consumes: Task 1 存储层
- Produces:
  - `GET /api/prompts` → `{ items: [{ key, default, override: string|null }] }`（5 项全量）；`PUT /api/prompts` body `{ key, content }` → `{ ok: true }`
  - `GET /api/prefs` → `{ prefs: UserPref[] }`；`DELETE /api/prefs?id=<n>` → `{ ok: true }`（不存在 404）
  - `GET /api/usage/summary?days=7|30|all`（缺省 all）→ `{ rows: [{ action, model, count, prompt_tokens, completion_tokens }], total: { count, prompt_tokens, completion_tokens } }`
  - settings PUT 接受 `userDirective?: string` 透传（保留旧遮罩逻辑不动）

- [ ] **Step 1: 三路由 + settings 扩展**（参数非法 400；沿用 NextRequest/NextResponse 惯例）
- [ ] **Step 2: 验证**：tsc 通过；curl 冒烟 5 条（GET prompts 返回 5 项含 defaults；PUT 写入→GET 看到 override→PUT 空串清除；prefs 增删查；usage/summary?days=7 rows 与 node 直查 `SELECT action, COUNT(*) FROM usage_ledger WHERE created_at > ? GROUP BY action` 数字一致——Review Focus #5）
- [ ] **Step 3: Commit** `feat(agent): 个性化 API——prompts/prefs/usage-summary + settings.userDirective`

### Task 6: 设置页「个性化」Tab UI

**Files:**
- Modify: `src/components/SettingsDrawer.tsx`

**Interfaces:**
- Consumes: Task 5 全部 API、Task 1 `PromptKey`/`UserPref` 类型（`import type`）
- Produces: 无后继

- [ ] **Step 1: 新 Tab「个性化」**（沿用既有 Tab 结构）三区：
  1. **我的偏好**：用户指令 textarea（保存走 `PUT /api/settings` 带 `userDirective`）；偏好列表（来自 `GET /api/prefs`，每条 ✕ 删除调 `DELETE /api/prefs?id=`）；空态"在对话里说「记住：…」即可添加"；
  2. **Prompt 自定义**：5 个折叠面板（对话追加/解题/复习笔记/地图路由/地图关系），每项 textarea +「保存」+「恢复默认」（恢复=PUT 空串+回填 default）；显示"已自定义/默认"徽标；
  3. **用量**：`GET /api/usage/summary`，7 天/30 天/全部切换，表格（功能/模型/次数/prompt/completion tokens）。
- [ ] **Step 2: 验证**：tsc 通过；手动验收（规格 §6 条 1/2/3/5 对应 UI 路径逐条走查，留待 Task 7 汇总）
- [ ] **Step 3: Commit** `feat(agent): 设置页个性化 Tab（指令/偏好/Prompt/用量）`

### Task 7: 全量回归 + 手动验收

**Files:** 无新改动（如验收发现问题按 systematic-debugging 修复）

- [ ] **Step 1: 全套自动化**：`npx tsc --noEmit` + `verify-personal-store` + `verify-agent-core` + `verify-context-fold` + `verify-revproxy-fn` + `verify-todo-store` 全绿；`npm run build`（dev server 未占 `.next` 时）或 tsc 替代并记录
- [ ] **Step 2: 手动验收**（规格 §6 逐条 + Review Focus #3）：
  1. 用户指令生效（模型复述）；2. "记住：…"存偏好→下次生效→删除后失效；3. 改 ask Prompt 行为变→恢复默认还原；4. 长对话折叠提示出现、短对话无变化（一期回归）；5. 用量表数字对账；6. 一期功能零回归（任务面板/Agent Loop/工具/引用）
- [ ] **Step 3: Commit（如有修复）** `fix(agent): 二期验收修复`
