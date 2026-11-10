# IF.Cope Agent 二期 · 个性化与上下文 · 架构规格（2026-11-10）

> 状态：**待用户评审**。评审通过后进入 writing-plans 拆实施计划。
> 上游：`docs/2026-11-10-agent应用调研报告.md`（二期路线）、`docs/superpowers/specs/2026-11-10-agent-core-phase1-design.md`（一期，已交付）。
> 用户决策（2026-11-10）：**偏好记忆手动为主（对话里说"记住：…"→ 存偏好库）；Prompt 可配置覆盖 chat/ask/产物生成类（含知识地图路由/关系标注），翻译除外；个性化配置并入设置页新 Tab**。

## 1. 背景与目标

一期交付了 Agent 内核（任务规划/循环显式化/健壮性）。二期解决"用得顺手"：

| 缺口 | 现状（2026-11-10 代码核实） |
|---|---|
| 无用户级指令 | 系统提示词写死：`agent/system.ts`（chat）、`api/ask/route.ts` 的 `SYSTEM`/`ROUTER_SYSTEM`/`REL_SYSTEM`、`lib/artifact.ts` 的 `SYSTEM` 共 5 处；用户无法表达"我喜欢简洁回答"这类长期偏好 |
| Prompt 不可配置 | 同上 5 处硬编码；改一次要动代码 |
| 无偏好记忆 | 每次对话从零开始，不记得用户的习惯与背景 |
| 上下文粗糙 | `history.slice(-8)` 固定截断（`llm.ts:57`），长对话前面内容无声丢失；无 token 用量展示（`usage_ledger` 表已有数据但无 UI） |

目标（G1-G4）：

- **G1 用户级指令**：设置页可编辑「我的偏好」（自由文本，AGENTS.md 式），运行时注入所有 LLM 场景；
- **G2 Prompt 可配置**：5 个场景提示词可改、可恢复默认；chat 因含动态段（工具清单/资料库状态/任务清单）只开放"追加指令"，其余 4 个开放整体替换；
- **G3 偏好记忆**：对话里说"记住：…"→ 模型调工具存入偏好库（`user_prefs` 表）；启动时注入；可列出/删除；
- **G4 上下文工程**：历史按 token 预算分层截断（旧轮摘要化）+ 设置页用量展示（消费 `usage_ledger` 既有数据）。

零回归：一期的 Agent Loop/任务面板/工具/引用标注行为不变。

## 2. 总体架构

```
┌─ 设置页「个性化」Tab（新增）─────────────────────────────┐
│ 我的偏好（自由文本编辑）  Prompt 自定义（5 场景）          │
│ token 用量统计（usage_ledger 聚合）                      │
└──────────────┬───────────────────────────────────────────┘
               ▼ 存储
┌─ SQLite ─────────────────────────────────────────────────┐
│ user_prefs(id,text,created_at)          ← G3 偏好库      │
│ prompt_overrides(key,content,updated_at)← G2 覆盖表      │
│ settings.model JSON 扩展 { userDirective } ← G1 用户指令 │
│ usage_ledger(已有)                      ← G4 用量展示     │
└──────────────┬───────────────────────────────────────────┘
               ▼ 运行时注入
┌─ LLM 场景（5 处提示词，统一走 resolvePrompt()）───────────┐
│ chat: buildSystemPrompt = 默认骨架(动态) + 用户指令 + 偏好 │
│ ask / artifact / map_router / map_rel: 覆盖表优先于默认   │
└───────────────────────────────────────────────────────────┘
```

## 3. 规格明细

### 3.1 数据模型（新增 2 表 + 1 字段）

```sql
user_prefs(                      -- G3 偏好库（对话"记住：…"写入）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',  -- manual | imported（预留）
  created_at INTEGER NOT NULL
)
prompt_overrides(                -- G2 提示词覆盖（无记录 = 用代码默认值）
  key TEXT PRIMARY KEY,          -- chat_append | ask_system | artifact_summary | map_router | map_rel
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

`settings.model` JSON 增加 `userDirective: string`（G1 用户级指令，自由文本，与偏好分离：指令=稳定的自我描述/规则，偏好=逐条记忆）。

### 3.2 G1 用户级指令 + G3 偏好记忆

**注入格式**（所有 LLM 场景统一，追加在各自默认提示词之后）：

```
<user_profile>
【用户指令】（若非空）
{userDirective}

【长期偏好】（若有）
- {pref_1}
- {pref_2}
</user_profile>
```

**偏好工具**（chat Agent 新增 3 个工具，复用一期 `ToolContext`/`runTool` 机制）：

| 工具 | 参数 | 语义 |
|---|---|---|
| `save_preference` | `text: string` | 学生明确说"记住/以后都/别再"时调用；幂等（同文本不重复存） |
| `list_preferences` | 无 | 列出全部偏好（id + text） |
| `delete_preference` | `id: number` | 删除一条 |

提示词规则（注入 `<task_management>` 同级）：只在学生**明确要求**时存偏好，不主动猜测；存入前复述确认文本。上限 50 条，超出提示先清理。

### 3.3 G2 Prompt 可配置

- `resolvePrompt(key: string, fallback: string): string`（新 `lib/prompts.ts`）：`prompt_overrides` 有记录用覆盖值，否则用代码默认；
- 5 个 key 与来源：
  - `ask_system` → `api/ask/route.ts` `SYSTEM`
  - `map_router` → `ROUTER_SYSTEM`
  - `map_rel` → `REL_SYSTEM`
  - `artifact_summary` → `lib/artifact.ts` `SYSTEM`
  - `chat_append` → chat 的**追加指令**（不动态骨架；拼在 `<user_profile>` 之后）
- 设置页「个性化」Tab：每项文本域 +「恢复默认」按钮（默认值由 GET `/api/prompts` 返回 `defaults` 供前端填充，含当前是否被覆盖）；保存写 `prompt_overrides`（`chat_append` 存空串=清除）；
- 5 处默认文案原样保留为 `fallback`（零回归硬约束）。

### 3.4 G4 上下文工程

**历史分层截断**（替换 `history.slice(-8)`）：

- token 预算：历史区上限 `min(模型上下文 × 0.25, 4000)` tokens（`estimateTokens` 估算）；
- 策略：从旧到新累加；超预算的**最老连续轮次**折叠为一条 `system` 摘要占位（"（此前 N 轮对话已省略，话题：…）"——取被折叠消息首问前 40 字，不调模型、纯截断，二期不做真摘要）；保留最近 2 轮完整不折叠；
- 用户消息+资料片段超预算时，资料片段按现有 `buildContextBlocks` 截断逻辑处理（不动）。

**用量展示**（设置页「个性化」Tab 底部）：

- `GET /api/usage/summary` → `usage_ledger` 按 feature/model 聚合（`sum(prompt_tokens)`, `sum(completion_tokens)`, `count(*)`, 最近 7 天/30 天/全部）；
- 表格式展示：功能（chat/ask/translate/embed）、模型、次数、prompt/completion tokens；纯只读。

## 4. 不做的事（本期范围外）

- 自动偏好提炼（对话后小模型总结偏好）——用户选"手动为主"，自动候选留三期后评估；
- 真摘要压缩（折叠区调模型生成摘要）——本期纯截断；
- 多套人设/配置切换（profiles）——单用户单指令够用；
- Prompt 版本管理/导入导出；
- 翻译提示词定制（用户明确排除）。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户改坏 Prompt 导致功能异常 | 每项「恢复默认」一键还原；`resolvePrompt` 空串视为无覆盖 |
| 偏好膨胀注入过长 | 上限 50 条、注入区截断 2000 字符；设置页可删 |
| chat 动态骨架被破坏 | chat 只开放 `chat_append` 追加，骨架不可覆盖 |
| 覆盖提示词被上游当旧缓存 | `prompt_overrides.updated_at` 参与无缓存场景（现状无缓存，仅防御） |
| 历史折叠丢关键上下文 | 保留最近 2 轮完整 + 折叠区只占位提示"已省略"，模型知有省略即可 |

## 6. 验收标准

1. 设置页「个性化」Tab：编辑用户指令 → 新对话生效（模型复述指令可验证）；
2. 对话里说"记住：回答别用列表"→ 模型调 `save_preference`，偏好区出现该条；下次新对话回答风格变化；删掉后不再生效；
3. 改 `ask_system` 覆盖 → 解题页行为变化；点「恢复默认」→ 行为还原；
4. 长对话（>4000 tokens 历史）：请求不超限、模型知道"此前已省略"；短对话无折叠（零回归）；
5. 用量表显示 chat/ask 等各功能 token 统计，与 `usage_ledger` 数字一致；
6. 一期回归：任务面板/Agent Loop/7 个资料库工具/引用标注全部照旧；`tsc` + verify 脚本 + `npm run build`（或 tsc 替代）通过。
