# Agent 三期 · 技能体系（SKILL.md 式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会话 Agent（工作台对话 + 解题答疑对话两种展示形态）能按需加载 `data/skills/<name>/SKILL.md` 技能指令包，并提供设置页「技能」管理界面。

**Architecture:** 单一数据源是 `data/skills/` 下的 SKILL.md 文件（frontmatter + Markdown 正文）；`src/lib/agent/skills.ts` 提供解析/校验/读写/播种 + `load_skill` 执行逻辑（一份实现）；系统提示注入 `<skills>` 索引段，模型经 `load_skill` 工具按需读正文（渐进式披露）；chat（`src/lib/llm.ts` 管线）与 ask（`src/app/api/ask/route.ts` 管线）各做薄注册。

**Tech Stack:** Next.js 15 / TypeScript / better-sqlite3（不涉及新表）/ 裸 Node verify 脚本（无新依赖）。

**Spec:** `docs/superpowers/specs/2026-11-11-agent-phase3-skills-design.md`

## Global Constraints

- **零新依赖**：不引 YAML/框架包；frontmatter 自写按行解析（`key: value`，取第一个冒号）
- 常量：`BODY_MAX = 8000`（正文截断，超出追加 `……（已截断）`）、`DESC_MAX = 300`（description 截断，无后缀）
- 技能名校验：`/^[a-z0-9-]{1,40}$/`，不通过一律拒绝（含 `../`、大写、点、斜杠）
- 技能只是 Markdown 指令，**不执行任何代码**（本期安全边界）
- skills 目录：`process.env.IFCOPE_SKILLS_DIR ?? path.join(process.cwd(), "data", "skills")`（env 供 verify 测试隔离）
- TDD 惯例：`scripts/verify-skill-store.mjs` 裸 Node 跑纯逻辑（`import ... from "../src/lib/agent/xxx.ts"` 相对扩展名导入）；挂进 `npm run verify` 链
- UI 文案中文；提交信息用中文 `feat(agent): ...` / `verify: ...` 风格（参照 git log）
- 每个任务收尾 `npm run verify` + `npm run typecheck` 全绿再 commit

## Review Focus

1. **非法技能名/路径穿越**（`../evil`、`MySkill`、41 字符名）打进 writeSkill/readSkillBody/deleteSkill/load_skill/PUT/DELETE → 一律拒绝，绝不触碰 `data/skills/` 之外的文件 — Task 1 名称校验断言、Task 2 前缀检查断言、Task 5 路由 400 断言
2. **用户手改坏 frontmatter**（缺 `---`、缺 name、enabled 非布尔）→ 该技能标 `error` 隔离，其余技能与系统提示构建不受影响 — Task 2 verify 断言（坏文件 + 好文件共存目录）
3. **技能正文超长**（>8000 字）→ 截断为 `8000 字 + ……（已截断）`，不破坏消息结构 — Task 1 verify 精确值断言
4. **`data/skills/` 不存在/空/无 `.seeded`** → listSkills 不抛崩；首次播种 exam-plan 且**只播一次**（UI 删除后不复活）— Task 2 verify 断言（播种 + 删除后不再播种）
5. **ask 无地图（mapId 空）时技能工具仍可加载、地图工具不误发**；上游不支持 tools 的降级分支（400/422 去 tools 重试）不因新增工具破坏 — Task 4 手动冒烟步骤钉死（无单测，见该任务 Step 4）

---

### Task 1: skills.ts 解析层（纯函数）+ verify 脚本骨架

**Files:**
- Create: `src/lib/agent/skills.ts`（本任务只写解析层，IO 层 Task 2）
- Create: `scripts/verify-skill-store.mjs`
- Modify: `package.json:13`（verify 链追加本脚本）

**Interfaces:**
- Consumes: 无（纯函数，无相对导入）
- Produces（后续任务依赖，签名固定）:
  - `type ParsedSkill = { name: string; description: string; enabled: boolean; body: string; error?: string }`
  - `isValidSkillName(name: string): boolean` — `/^[a-z0-9-]{1,40}$/`
  - `parseSkillFile(text: string, dirName: string): ParsedSkill` — frontmatter 拆分；name 恒取 `dirName`（覆盖 frontmatter）；body 去 frontmatter 后 trim + 截断
  - `buildSkillsIndexText(skills: ParsedSkill[]): string` — 只收 `enabled && !error`；空则返回 `""`
  - 常量 `BODY_MAX = 8000`、`DESC_MAX = 300`

- [ ] **Step 1: 写失败的 verify 断言（解析层）**

`scripts/verify-skill-store.mjs`（先只写本任务断言，Task 2/3 追加）：

```js
import assert from "node:assert/strict";
import { parseSkillFile, isValidSkillName, buildSkillsIndexText, BODY_MAX, DESC_MAX } from "../src/lib/agent/skills.ts";

// 1. 正常解析：name 取目录名（覆盖 frontmatter）、enabled 默认 true、正文去 frontmatter
const good = `---\nname: other-name\ndescription: 复习计划用\n---\n# 标题\n正文内容`;
const p = parseSkillFile(good, "exam-plan");
assert.equal(p.name, "exam-plan");
assert.equal(p.description, "复习计划用");
assert.equal(p.enabled, true);
assert.equal(p.error, undefined);
assert.ok(p.body.startsWith("# 标题"));

// 2. enabled: false 解析；缺 enabled 默认 true
assert.equal(parseSkillFile(`---\nname: a\nenabled: false\n---\nx`, "a").enabled, false);
assert.equal(parseSkillFile(`---\nname: a\n---\nx`, "a").enabled, true);

// 3. 错误分支：缺 frontmatter / 缺 name → error，且 enabled 强制 false
assert.ok(parseSkillFile("没有 frontmatter", "a").error);
assert.ok(parseSkillFile(`---\ndescription: x\n---\ny`, "a").error);
for (const bad of [parseSkillFile("x", "a"), parseSkillFile(`---\nd: 1\n---\ny`, "a")]) {
  assert.equal(bad.enabled, false);
  assert.equal(bad.body, "");
}

// 4. 名称校验：非法一律 false
for (const n of ["../evil", "MySkill", "a b", "a.b", "", "x".repeat(41)]) assert.equal(isValidSkillName(n), false, n);
assert.equal(isValidSkillName("exam-plan"), true);

// 5. 截断：正文 >8000 → 精确等于 8000 字 + 后缀；description >300 截到 300 无后缀
const long = parseSkillFile(`---\nname: a\n---\n${"x".repeat(9000)}`, "a");
assert.equal(long.body, "x".repeat(BODY_MAX) + "……（已截断）");
const longDesc = parseSkillFile(`---\nname: a\ndescription: ${"d".repeat(400)}\n---\nx`, "a");
assert.equal(longDesc.description.length, DESC_MAX);

// 6. 索引段：只收 enabled && !error；格式含序号与破折号；全空返回 ""
const idx = buildSkillsIndexText([
  { name: "a", description: "A用", enabled: true, body: "" },
  { name: "b", description: "B用", enabled: false, body: "" },
  { name: "c", description: "C用", enabled: true, body: "", error: "坏文件" },
]);
assert.ok(idx.startsWith("<skills>") && idx.endsWith("</skills>"));
assert.ok(idx.includes("1. a — A用") && !idx.includes("b —") && !idx.includes("c —"));
assert.equal(buildSkillsIndexText([]), "");

console.log("verify-skill-store: 解析层 OK");
```

- [ ] **Step 2: 跑 verify 确认失败**

Run: `node scripts/verify-skill-store.mjs`
Expected: FAIL（找不到 `../src/lib/agent/skills.ts` 模块）

- [ ] **Step 3: 实现 `src/lib/agent/skills.ts` 解析层**

按 Interfaces 的签名实现，要点（其余留给实现者）：
- frontmatter：仅当首行是 `---` 时生效，取到下一个 `---` 行之间的 `key: value` 行（第一个冒号切分，值 trim）；`enabled` 解析为 `String(v).trim().toLowerCase() !== "false"`（缺省 true）
- 错误文案（中文，进 `error` 字段）：`缺少 frontmatter` / `缺少 name 字段` / `目录名非法`；错误技能返回 `{ name: dirName, description: "", enabled: false, body: "", error }`
- description 超 `DESC_MAX` 截断；body（去 frontmatter 后 `trim()`）超 `BODY_MAX` 截断 + `……（已截断）`
- `buildSkillsIndexText` 输出格式（第一行规则文案固定）：

```
<skills>
你有以下技能（可复用的任务指令包）。当学生的任务匹配某技能的 description 时，先调用 load_skill 加载该技能正文，然后严格按其步骤执行；不匹配的技能不要加载。
1. a — A用
</skills>
```

- [ ] **Step 4: 跑 verify 确认通过**

Run: `node scripts/verify-skill-store.mjs`
Expected: `verify-skill-store: 解析层 OK`

- [ ] **Step 5: verify 链接入 + 全量验证 + Commit**

`package.json` 的 `verify` 脚本末尾追加 ` && node scripts/verify-skill-store.mjs`。
Run: `npm run verify && npm run typecheck` → 全绿。

```bash
git add src/lib/agent/skills.ts scripts/verify-skill-store.mjs package.json
git commit -m "feat(agent): 技能解析层——SKILL.md frontmatter 解析/名称校验/截断/索引文本"
```

### Task 2: skills.ts IO 层 + 播种

**Files:**
- Modify: `src/lib/agent/skills.ts`（追加 IO 层）
- Modify: `scripts/verify-skill-store.mjs`（追加 IO 断言；用 `IFCOPE_SKILLS_DIR` 指临时目录）

**Interfaces:**
- Consumes: Task 1 的 `ParsedSkill` / `isValidSkillName` / `parseSkillFile`
- Produces:
  - `skillsDir(): string` — `process.env.IFCOPE_SKILLS_DIR ?? path.join(process.cwd(), "data", "skills")`
  - `listSkills(): ParsedSkill[]` — 扫 `skillsDir()/*/SKILL.md`；调用开头先 `ensureSeedSkills()`；坏文件返回带 `error` 的条目
  - `readSkillBody(name: string): string` — 校验名称 + `path.resolve` 前缀必须在 `skillsDir()` 内；不存在/禁用/坏文件 throw
  - `writeSkill(name: string, description: string, body: string, enabled: boolean = true): void` — 幂等覆盖 `skillsDir()/name/SKILL.md`
  - `deleteSkill(name: string): boolean` — 删技能目录，不存在返回 `false`（路由据此 404）
  - `skillsIndexText(): string` — `buildSkillsIndexText(listSkills())`
  - `ensureSeedSkills(): void` — 见下

- [ ] **Step 1: 追加失败的 IO 断言**

verify 脚本顶部（静态 import 之前）设置隔离目录，追加断言：

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ifcope-skills-"));
process.env.IFCOPE_SKILLS_DIR = TMP; // 必须在首次调用 listSkills 前生效（skillsDir() 惰性读取）
// ...新增 import：listSkills, readSkillBody, writeSkill, deleteSkill, skillsIndexText, ensureSeedSkills

// 7. 播种：空目录首次 listSkills → 自动生成 exam-plan 与 .seeded 标记
assert.equal(fs.existsSync(path.join(TMP, ".seeded")), false);
const seeded = listSkills();
assert.equal(seeded.length, 1);
assert.equal(seeded[0].name, "exam-plan");
assert.ok(fs.existsSync(path.join(TMP, ".seeded")));

// 8. 只播一次：删除后不复活
deleteSkill("exam-plan");
assert.equal(listSkills().length, 0);

// 9. writeSkill/readSkillBody/parseSkillFile 往返
writeSkill("my-skill", "测试用描述", "# 正文");
assert.equal(readSkillBody("my-skill"), "# 正文");
assert.equal(listSkills().find((s) => s.name === "my-skill")?.description, "测试用描述");

// 10. 坏文件隔离：坏的标 error，好的照常
fs.mkdirSync(path.join(TMP, "bad-skill"));
fs.writeFileSync(path.join(TMP, "bad-skill", "SKILL.md"), "没有 frontmatter");
assert.equal(listSkills().find((s) => s.name === "bad-skill")?.error, "缺少 frontmatter");
assert.ok(listSkills().find((s) => s.name === "my-skill")?.error === undefined);

// 11. 路径安全：readSkillBody/deleteSkill 拒绝非法名（不触碰 TMP 之外）
for (const n of ["../evil", "MySkill", "a/b"]) {
  assert.throws(() => readSkillBody(n), /./, n);
  assert.throws(() => deleteSkill(n), /./, n);
}
assert.throws(() => readSkillBody("not-exist"), /./, "不存在应 throw");

// 12. 禁用技能不可 read
writeSkill("off-skill", "关", "x", false);
assert.throws(() => readSkillBody("off-skill"), /禁用|已禁用/, "禁用应 throw");
assert.equal(skillsIndexText().includes("off-skill"), false, "禁用不进索引");

fs.rmSync(TMP, { recursive: true, force: true });
console.log("verify-skill-store: IO 层 OK");
```

- [ ] **Step 2: 跑 verify 确认失败**

Run: `node scripts/verify-skill-store.mjs`
Expected: FAIL（listSkills 等未导出）

- [ ] **Step 3: 实现 IO 层**

按 Interfaces 实现，要点：
- `ensureSeedSkills()`：`skillsDir()/.seeded` 不存在时 → mkdir 递归建目录，写入示例技能 `exam-plan`（内容见下方固定文案）并 touch `.seeded`；**判定只看 `.seeded`**，不看目录是否为空
- `readSkillBody` / `deleteSkill` 双保险：`isValidSkillName(name)` 先行 + `path.resolve(skillsDir(), name)` 必须以 `path.resolve(skillsDir()) + path.sep` 开头
- `readSkillBody` 语义：不存在 / `enabled === false` / 有 `error` 均 throw（中文信息，含原因）

播种的 `data/skills/exam-plan/SKILL.md` 固定文案：

```markdown
---
name: exam-plan
description: 生成复习计划/备考安排时使用（当学生问“怎么复习”“帮我排计划”“期末怎么准备”）
enabled: true
---
# 复习计划制定

按以下步骤为学生制定复习计划：

1. **诊断现状**：明确考试科目、考试时间、当前掌握程度（资料库有相关资料时用 list_library / read_source 了解内容）
2. **拆分阶段**：按周拆分——基础回顾 / 重点强化 / 真题演练 / 考前收心，各阶段给出天数
3. **每日任务**：每阶段列出具体每日任务（科目 + 内容 + 时长），总量控制在学生可执行范围
4. **复盘节奏**：约定复盘点（如每周日晚回顾完成率），给出调整规则
5. **输出格式**：用表格呈现每日任务，结尾给一句鼓励和首要行动

约束：计划基于学生真实时间，不要假设每天 8 小时；缺关键信息先问，不编造考试信息。
```

- [ ] **Step 4: 跑 verify 确认通过**

Run: `node scripts/verify-skill-store.mjs`
Expected: `verify-skill-store: IO 层 OK`（解析层断言也仍全过）

- [ ] **Step 5: 全量验证 + Commit**

Run: `npm run verify && npm run typecheck` → 全绿。

```bash
git add src/lib/agent/skills.ts scripts/verify-skill-store.mjs
git commit -m "feat(agent): 技能存储 IO——扫描/读写/删除/播种 + 路径安全双保险"
```

### Task 3: `load_skill` 工具接入 chat 管线 + 系统提示注入

**Files:**
- Modify: `src/lib/agent/tools.ts`（ToolContext 加 `loadedSkills`、TOOLS 注册、executeTool case）
- Modify: `src/lib/agent/executor.ts:9-21`（TOOL_POLICY 加 load_skill）
- Modify: `src/lib/agent/system.ts`（buildSystemPrompt 注入 `<skills>` 段）
- Modify: `src/lib/llm.ts`（streamChat 建 `loadedSkills` Set 传入 runTool）
- Modify: `src/lib/agent/skills.ts`（追加 `SKILL_TOOL` + `executeLoadSkill`）
- Modify: `scripts/verify-skill-store.mjs`（追加 executeLoadSkill 断言）

**Interfaces:**
- Consumes: Task 2 全部；`ToolContext = { threadId: number; loadedSkills?: Set<string> }`（tools.ts 内改）
- Produces:
  - `SKILL_TOOL` — OpenAI function 格式工具定义常量（name `load_skill`，参数 `{ name: string }`，required `["name"]`；description：`加载一个技能（SKILL.md 任务指令包）的完整正文。当学生的任务匹配 <skills> 索引中某技能的 description 时，先加载并遵循其步骤执行`）
  - `executeLoadSkill(args: Record<string, unknown>, ctx: { loadedSkills?: Set<string> }): string` — **同步**（纯文件读，无 async）；语义见 Step 3

- [ ] **Step 1: 追加失败的 executeLoadSkill 断言**

```js
// 13. load_skill：命中返回正文；重复加载去重；未知/禁用 throw 且信息含可用清单
writeSkill("demo-skill", "演示", "# 演示正文");
const ctx = { loadedSkills: new Set() };
const r1 = executeLoadSkill({ name: "demo-skill" }, ctx);
assert.ok(r1.includes("# 演示正文"));
const r2 = executeLoadSkill({ name: "demo-skill" }, ctx);
assert.ok(r2.includes("已加载"), r2);
assert.throws(() => executeLoadSkill({ name: "no-such" }, ctx), /demo-skill|可用/, "错误应含可用清单");
executeLoadSkill({ name: "demo-skill" }, {}); // 无 ctx.loadedSkills 不去重、不崩
console.log("verify-skill-store: load_skill OK");
```

注意：`executeLoadSkill` 命中 throw 分支要在 `ctx.loadedSkills?.add(name)` **之前**返回错误（失败不记去重）。

- [ ] **Step 2: 跑 verify 确认失败**

Run: `node scripts/verify-skill-store.mjs`
Expected: FAIL（executeLoadSkill 未导出）

- [ ] **Step 3: 实现共享接入**

- `skills.ts`：`SKILL_TOOL` 按 Interfaces；`executeLoadSkill` 语义：
  1. `name = String(args.name ?? "").trim()`，空 → throw
  2. `ctx.loadedSkills?.has(name)` → 返回 `技能《${name}》已在本次任务中加载过，请直接遵循其步骤，无需重复加载`
  3. `listSkills()` 找 `name` 相等且 `enabled && !error` 的技能；找不到 → throw `技能「${name}」不存在或已禁用。当前可用技能：${可用名列表或"（无）"}`（**先 throw 后记去重**）
  4. `ctx.loadedSkills?.add(name)`，返回 `技能《${name}》正文：\n\n${body}`
- `tools.ts`：`ToolContext` 加 `loadedSkills?: Set<string>`；`TOOLS` 数组追加 `SKILL_TOOL`；`executeTool` 加 `case "load_skill": return executeLoadSkill(call.args, ctx);`
- `executor.ts`：`TOOL_POLICY` 加 `load_skill: { timeoutMs: 10_000, retry: true }`（只读可重试）
- `system.ts`：函数顶部 `const skillsText = skillsIndexText();`，在「调用原则」列表结束、`${userSection ...}` 之前插入 `${skillsText ? `\n${skillsText}\n` : ""}`（空技能不注入整段）
- `llm.ts`：streamChat 循环前 `const loadedSkills = new Set<string>();`，`runTool(call, { threadId, loadedSkills })`

- [ ] **Step 4: 跑 verify 确认通过**

Run: `node scripts/verify-skill-store.mjs`
Expected: `verify-skill-store: load_skill OK`

- [ ] **Step 5: 全量验证 + Commit**

Run: `npm run verify && npm run typecheck` → 全绿（既有 6 个 verify 脚本不得回归）。

```bash
git add src/lib/agent/tools.ts src/lib/agent/executor.ts src/lib/agent/system.ts src/lib/llm.ts src/lib/agent/skills.ts scripts/verify-skill-store.mjs
git commit -m "feat(agent): load_skill 工具接入 chat 管线 + <skills> 索引注入系统提示"
```

### Task 4: `/api/ask` 接入（解题答疑展示形态）

**Files:**
- Modify: `src/app/api/ask/route.ts`

**Interfaces:**
- Consumes: `skillsIndexText()` / `SKILL_TOOL` / `executeLoadSkill`（Task 3 产出，从 `@/lib/agent/skills` 导入）
- Produces: 无新接口（行为变化：ask 管线可加载技能）

- [ ] **Step 1: 系统提示与工具表接入**

- 系统提示：`resolvePrompt("ask_system", PROMPT_DEFAULTS.ask_system)` 的结果后追加 `\n\n${skillsIndexText()}`（空串时自然无追加）
- 工具组装：现有 `withTools = Boolean(map && map.nodes.length > 0)` 改为
  `const mapTools = map && map.nodes.length > 0 ? MAP_TOOLS : []; const skillTools = skillsIndexText() ? [SKILL_TOOL] : []; const activeTools = [...mapTools, ...skillTools];`
  `reqBody` 中 `...(activeTools.length ? { tools: activeTools, tool_choice: "auto" } : {})`；400/422 降级去 tools 的分支用 `activeTools.length` 判断，其余不动

- [ ] **Step 2: `load_skill` 分发（1 轮封顶）**

在现有 `const tc = msg?.tool_calls?.[0]` 之后、地图工具 `if (tc && map && body.mapId != null)` 之前插入 load_skill 分支：

1. 命中 `tc.function.name === "load_skill"`（**不要求 map/mapId**）：解析参数（try/catch，损坏当 `{}`）→ `executeLoadSkill(args, { loadedSkills: new Set() })`，失败转成 `工具执行失败：${msg}` 文本（不 throw，不丢回答）
2. 二次请求产最终回答：把 `assistant`（`content: null, tool_calls: [原 tc]`）与 `tool`（`tool_call_id: tc.id`, content = 上一步结果）追加进 messages，**删除 `tools`/`tool_choice`**（强制纯文字，1 轮封顶）后重新 fetch
3. 复用现有非 ok 错误处理语义（HTTP 错误照现有文案 throw）；`answer = 二次响应 content.trim()`，空 → throw `模型返回了空内容`
4. 然后落回既有流程（引用过滤 → 节点落图 → 边落图），与普通问答无异

地图工具分支（update_map_edges/update_card）完全不动。

- [ ] **Step 3: 类型与静态验证**

Run: `npm run typecheck && npm run verify` → 全绿。

- [ ] **Step 4: 手动冒烟（对应 Review Focus 5）**

dev server 起在 3777，真模型验证三条（结果记录在提交信息或会话里）：
1. 解题答疑新提问（**无地图/mapId 空**）："帮我制定期末复习计划" → 不应出现 update_map_edges/update_card，回答应遵循 exam-plan 步骤（说明技能正文已注入）
2. 有地图时提问"整理一下连线" → 仍走 update_map_edges 正常路径（技能工具未破坏地图工具）
3. 临时把模型 baseUrl 指到不支持 tools 的旧路径（或观察日志）→ 400/422 降级分支仍工作

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ask/route.ts
git commit -m "feat(agent): 解题答疑接入技能——SKILL_TOOL 随地图工具按需下发 + load_skill 一轮续答"
```

### Task 5: `/api/skills` CRUD + 设置页「技能」Tab

**Files:**
- Create: `src/app/api/skills/route.ts`
- Create: `src/components/SettingsSkills.tsx`
- Modify: `src/components/SettingsDrawer.tsx:67,206,222`（tab state 联合类型加 `"skills"`、tab 列表加 `['skills', '技能']`、内容区渲染 `<SettingsSkills />`）

**Interfaces:**
- Consumes: `listSkills / writeSkill / deleteSkill / isValidSkillName`（Task 2）
- Produces:
  - `GET /api/skills` → `{ skills: ParsedSkill[] }`
  - `PUT /api/skills` body `{ name, description, body, enabled? }` → `{ ok: true, skill: ParsedSkill }`；name 非法 → 400 `{ error }`
  - `DELETE /api/skills?name=xxx` → `{ ok: true }`；name 非法 → 400；不存在 → 404
  - `<SettingsSkills />`（无 props，挂载自拉 GET）

- [ ] **Step 1: 实现 `/api/skills/route.ts`**

`export const runtime = "nodejs";`。GET/PUT/DELETE 按 Interfaces；PUT 校验顺序：`isValidSkillName(name)` 否则 400 → `writeSkill(...)`（enabled 缺省 true）→ 回读 `listSkills().find(...)` 返回。DELETE 先 400 校验、`deleteSkill` 返回 false 则 404。

- [ ] **Step 2: 实现 `<SettingsSkills />` 并挂进 SettingsDrawer**

组件自拉 `GET /api/skills`，UI 要素（文案中文）：
- 技能卡片列表：名称、description、`error` 条目红色标注错误原因、启用开关（PUT `enabled` 反转）、编辑、删除
- 删除二次确认：点击「删除」后按钮变「确认删除？」，再点才调 DELETE（3 秒内未点自动还原）
- 新建技能：name 输入 + description + body textarea（预置模板 `# 技能标题\n\n按以下步骤执行：\n1. …`），保存调 PUT
- 编辑态：description 与 body 的 textarea，保存/取消

SettingsDrawer 改动最小化：只动 tab 联合类型（`useState<"model" | "personal" | "skills">`）、tab 数组、内容区三元，不动既有两个 Tab 的实现。

- [ ] **Step 3: 类型与静态验证**

Run: `npm run typecheck && npm run verify` → 全绿。

- [ ] **Step 4: 手动冒烟（对应 Review Focus 1）**

1. 设置页「技能」Tab：新建 → 列表出现；编辑保存 → 刷新仍在；开关禁用 → 对话不再 load（Task 3 冒烟复测）；删除（走二次确认）→ 列表消失
2. 非法 name 打接口被拒：`curl -X PUT http://localhost:3777/api/skills -H "Content-Type: application/json" -d '{"name":"../evil","description":"x","body":"y"}'` → 400；DELETE 同名 → 400

- [ ] **Step 5: Commit**

```bash
git add src/app/api/skills/route.ts src/components/SettingsSkills.tsx src/components/SettingsDrawer.tsx
git commit -m "feat(agent): 技能管理——/api/skills CRUD + 设置页技能 Tab（启停/编辑/二次确认删除）"
```

---

## 收尾

- 整体回归：`npm run verify && npm run typecheck` 全绿；真模型冒烟三条（chat 触发 load_skill / 禁用后不触发 / ask 触发）过
- 分支收尾按 superpowers:finishing-a-development-branch 决定合并方式
