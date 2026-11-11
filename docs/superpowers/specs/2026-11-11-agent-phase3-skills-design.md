# IF.Cope Agent 三期 · 技能体系（SKILL.md 式）· 架构规格（2026-11-11）

## 1. 背景与目标

Agent 一期（工具循环）与二期（个性化/上下文工程）已落地。三期原计划包含四项：技能体系、破坏性操作三档确认、API Key 加密落库、防泄露。经需求确认，**本期只做技能体系**；三档确认的分档方案已定（只读免确认 / 可逆需确认 / 不可逆需强确认）但后置到下一期；API Key 加密与防泄露暂缓。

**目标**：让**会话 Agent**（工作台对话框与解题答疑对话框是同一个会话能力，唯一区别是展示形式——工作台为时间线流式对话，解题答疑渲染为知识地图卡片）能加载用户编写的、可扩展的任务指令包（SKILL.md 式技能），按需注入上下文，从而在不改代码的情况下扩展 Agent 的任务能力（如"复习计划制定""错题归因分析"等固定流程/方法论）。

**成功标准**：
- 用户在 `data/skills/` 下放置 SKILL.md，对话中模型能自主识别任务匹配并加载技能、按技能步骤执行
- 设置页可查看/新建/编辑/启停技能，无需手碰文件也能管理
- 技能是会话 Agent 层的能力：工作台对话与解题答疑对话（两种展示形态）都生效，后续新增展示形态也自然覆盖
- 技能多了不炸上下文（索引 + 按需加载，不全量注入）

**沿用惯例**：TDD verify 脚本（`scripts/verify-*.mjs` 裸 Node 跑纯逻辑）；`npm run verify` + `npm run typecheck` 全绿；本地优先、数据随 `data/` 走。

## 2. 总体架构

```
data/skills/<name>/SKILL.md          ← 单一数据源（frontmatter + Markdown 正文）
        │
        ▼
src/lib/agent/skills.ts              ← 解析/校验/读写/索引文本（纯函数可测）
        │
        ├── 会话 Agent 层（能力，一份实现）
        │     ├── buildSystemPrompt（chat）→ <skills> 索引段
        │     ├── /api/ask 路由             → 同一索引段附加到 ask_system 提示后
        │     └── TOOLS + MAP_TOOLS         → load_skill 工具（共享执行逻辑）
        └── /api/skills               → 设置页「技能」Tab 的 CRUD
```

**能力分层说明**：工作台对话（`/api/chat`）与解题答疑对话（`/api/ask`）是同一个会话 Agent 的两种**展示形态**（时间线流式 vs 知识地图卡片），不是两个产品能力。技能实现在会话 Agent 层，两条现有管线各自薄注册共享的技能模块；两条管线的历史差异（MAP_TOOLS、ask_system 提示）属展示形态差异，本期不做管线合并重构（见 §4），但技能层从第一天起完全共享、不复制逻辑。

加载机制 = **索引 + `load_skill` 按需加载**（渐进式披露）：系统提示只注入「技能名 — description」清单；模型判断任务匹配某技能时调用 `load_skill` 读取正文，正文随工具结果进入对话历史。

## 3. 规格明细

### 3.1 技能文件格式与存放

- 位置：`data/skills/<技能名>/SKILL.md`，一技能一目录。
- 格式：frontmatter（`---` 包围的 `key: value` 行）+ Markdown 正文：

```markdown
---
name: exam-plan
description: 生成复习计划/备考安排时使用（当学生问"怎么复习""帮我排计划""期末怎么准备"）
enabled: true
---
# 复习计划制定
（步骤、模板、约束……正文即注入模型的指令）
```

- 字段：
  - `name`：技能标识，`^[a-z0-9-]{1,40}$`（小写字母/数字/连字符，防路径穿越）。**必须与目录名一致**，不一致以目录名为准（解析时覆盖）。
  - `description`：触发描述，写"何时使用"（供模型判断是否加载）；存储保全量，注入模型时超 300 字截断。
  - `enabled`：`true`/`false`，缺省 `true`。禁用的技能不出现在索引、不可 load。
- frontmatter 解析自写轻量实现（按行解析 `key: value`，值取冒号后原文 trim），**不引第三方 YAML 依赖**。
- 正文/描述存储与管理 API 均保**全量**（设置页启停/编辑回写不丢数据）；对模型的暴露在注入点截断：load_skill 返回正文超 8000 字截断并追加 `……（已截断）`，索引段 description 超 300 字截断。
- 解析失败（无 frontmatter / 无 name / 非法 name）：跳过该技能，在 `listSkills` 结果中标记 `error` 状态（设置页可见错误原因），不影响其它技能。

### 3.2 核心库 `src/lib/agent/skills.ts`

纯函数（可被 verify 脚本直测）：
- `parseSkillFile(text: string, dirName: string): ParsedSkill` — frontmatter + 正文拆分、字段校验、目录名覆盖 name（全量，不截断）
- `buildSkillsIndexText(skills: ParsedSkill[]): string` — 生成 `<skills>` 索引段文本
- `isValidSkillName(name: string): boolean` — 名称白名单正则

IO 层（薄封装，不进 verify）：
- `listSkills(): SkillInfo[]` — 扫描 `data/skills/*/SKILL.md`，返回 `{ name, description, enabled, body, error? }`（含正文，供设置页；调用方可忽略 body）。每次调用重扫目录（技能数量小、文件即真源，不做缓存，避免失效问题）
- `readSkillBody(name: string): string` — 校验名称 + `path.resolve` 前缀检查后读正文；不存在/禁用抛错
- `writeSkill(name, description, body, enabled?)` — 建目录写文件（幂等覆盖）；name 非法拒绝
- `deleteSkill(name: string)` — 删除技能目录（仅删 `data/skills/` 前缀内的目录；校验同上）
- `skillsIndexText(): string` — 取 enabled 技能生成索引段（无技能时返回空串，系统提示不注入该段）

### 3.3 `load_skill` 工具

- 工具定义（`TOOLS` 与 `MAP_TOOLS` 各注册一份，定义从 `skills.ts` 导出的 `SKILL_TOOL` 常量复用）：

```
name: load_skill
参数: { name: string }  // 技能名（从 <skills> 索引里选）
```

- 行为：
  - 命中：返回 `技能《name》正文：\n\n<正文>`（正文在暴露点按 8000 字上限截断）
  - 同一任务内已加载过同名技能：返回 `技能《name》已在本次任务中加载过，请直接遵循其步骤，无需重复加载`（省 token）
  - name 不存在或已禁用：报错并附当前可用技能名列表（模型可自纠）
  - 去重记录放 `ToolContext.loadedSkills: Set<string>`，生命周期 = 一次请求的 Agent Loop（不落库；工具结果不进持久历史，跨消息本就需要重新加载）
- 执行逻辑 `executeLoadSkill(args, ctx)` 放 `skills.ts`，chat 的 `executeTool` 与 ask 路由的工具分发共用。

### 3.4 系统提示注入（会话 Agent 层，覆盖两种展示形态）

- `<skills>` 段格式（仅当有 enabled 技能时注入）：

```
<skills>
你有以下技能（可复用的任务指令包）。当学生的任务匹配某技能的 description 时，先调用 load_skill 加载该技能正文，然后严格按其步骤执行；不匹配的技能不要加载。
1. exam-plan — 生成复习计划/备考安排时使用……
2. ……
</skills>
```

- `/api/chat`（工作台对话）：`buildSystemPrompt`（`src/lib/agent/system.ts`）拼入 `skillsIndexText()`；`TOOLS` 追加 `SKILL_TOOL`（沿用 `listToolsText()` 动态清单，工具清单自动同步，无漂移）。
- `/api/ask`（解题答疑对话，展示为知识地图卡片）：路由的 `resolvePrompt("ask_system", …)` 结果后附加同一 `<skills>` 段；`MAP_TOOLS` 追加 `SKILL_TOOL`；工具分发处加 `load_skill` case（调 `executeLoadSkill`）。
- 技能正文进入对话历史后由既有 `foldHistory`（4000 token 预算、保最近 2 轮）分层截断兜底，无需新机制。

### 3.5 管理 API 与设置页「技能」Tab

- 新接口 `src/app/api/skills/route.ts`（nodejs runtime）：
  - `GET`：全部技能（含正文与 error 状态），供设置页渲染
  - `PUT`：`{ name, description, body, enabled? }` 新建/更新（按 name 幂等覆盖）；返回保存结果
  - `DELETE`：`?name=xxx` 删除技能
  - 错误：非法 name → 400；不存在 → 404
- 设置 Drawer 新增「技能」Tab（与既有「个性化」Tab 并列）：
  - 技能卡片列表：名称 / description / 启用开关 / 编辑 / 删除
  - 新建技能：填 name + description，正文预置模板（标题 + 步骤占位）
  - 编辑：description 与正文的 textarea；保存调 PUT
  - 删除：点击后需二次确认（删除按钮变为"确认删除？"再点才执行）——本期 UI 自带的最简强确认，不依赖后置的三档确认体系
  - 解析错误的技能卡片红色标注错误原因

### 3.6 示例技能播种

- skills 模块首次被调用时：若 `data/skills/.seeded` 标记不存在，写入示例技能 `exam-plan`（复习计划制定：诊断科目与时间 → 按周拆分 → 每日任务 → 复盘节奏）并创建 `.seeded` 标记文件，让学生/用户能直接发现并仿写。
- 播种判定以 `.seeded` 标记为准（**不是**"目录为空"）：只播一次，用户在 UI 删除示例技能后不会复活；重新播种 = 手动删掉 `.seeded`。

## 4. 不做的事（本期范围外）

- 破坏性操作三档确认（下一期；分档方案已定：只读免确认 / 可逆需确认 / 不可逆需强确认）
- API Key 加密落库、密钥防泄露
- 技能的代码执行能力（本期技能只是 Markdown 指令，不执行任何代码）
- 技能市场的导入导出、版本管理、多语言
- 按语义（嵌入）自动选择技能——本期靠模型读 description 自主判断
- 解题页/翻译页等其它入口的技能接入（本期会话 Agent 覆盖工作台与解题答疑两种展示形态）
- `/api/chat` 与 `/api/ask` 两条管线的合并重构（用户已确认两者是同一会话能力仅展示不同，但管线统一是独立的重构项，不在本期；技能层已按共享设计，重构时无返工）

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 技能正文（用户自写指令）注入 system prompt，可能与系统提示冲突或被诱导 | 技能属用户信任边界内（与 chat_append 同级）；`<skills>` 段声明"技能是学生自己写的任务指令"；不做沙箱（本期范围外） |
| 技能正文膨胀吃上下文 | 索引+按需加载；单技能正文 8000 字上限；foldHistory 兜底 |
| 路径穿越（name 含 `../` 等） | name 白名单正则 `^[a-z0-9-]{1,40}$` + `path.resolve` 前缀必须落在 `data/skills/` 内 |
| frontmatter 格式漂移（用户手写出错） | 解析宽松（缺 enabled 默认 true）、错误技能隔离标记不拖垮整体 |
| 重复加载浪费 token | 会话级去重：同名二次 load 返回"已加载"提示 |
| chat 与 ask 两处工具分发复制逻辑 | 执行逻辑只写一份（`executeLoadSkill`），两处薄注册 |

## 6. 验收标准

1. `scripts/verify-skill-store.mjs` 全部断言通过：frontmatter 解析（正常/缺字段/坏格式）、目录名覆盖 name、名称校验拒绝 `../`/大写/超长、正文 8000 字截断、索引段文本（含空技能不注入）、`load_skill` 去重与错误分支
2. `npm run verify`（7 个脚本）+ `npm run typecheck` 全绿
3. 手动冒烟（真模型）：
   - 设置页「技能」Tab 能新建/编辑/启停/删除技能
   - 工作台对话中问"帮我制定期末复习计划"→ 时间线出现 load_skill 调用 → 回答遵循 exam-plan 技能步骤
   - 禁用 exam-plan 后同样提问 → 不再调用 load_skill
   - 解题答疑对话（知识地图展示形态）中触发技能加载同样生效
4. 路径安全：手工构造非法 name 的 PUT/DELETE 被 400 拒绝
