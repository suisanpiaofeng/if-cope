# IF.Cope → AI 编程 Harness 改造 · 架构规格（2026-11-12）

> 前置文档：`docs/2026-11-12-harness-差距分析-Codex-ClaudeCode.md`（对照表与优先级）。
> 本文覆盖 **P0 全部详设** + P1 纲要。P0 分四块：Skill 安装改造 / Agent 文件工具与命令 / 三档确认安全底座 / 会话·模型·工作区配置。

## 0. 决策记录（已与用户确认）

| 决策 | 内容 |
|---|---|
| 命令执行 | 受限执行+三档确认：工作区目录内、危险命令硬拒绝/强确认、输出截断；强沙箱后置 P1 |
| 工作区根目录 | `data/workspace/`（`IFCOPE_WORKSPACE_DIR` 可覆盖，settings 可改路径），不碰项目自身代码 |
| 实施节奏 | P0 → P1 两批交付，每批逐项自测 |
| UI 承载 | 融入现有工作台（文件树并入资源栏视图切换，确认卡片进对话流），界面风格统一 |

## 1. 术语与不变量

- **工作区（workspace）**：文件工具/命令执行的根，默认 `data/workspace/`。所有路径 resolve 后必须落在 root 内，否则拒绝。
- **技能（skill）**：`data/skills/<name>/SKILL.md`，保持既有格式；frontmatter 扩展可选字段 `triggers`、`params`（不破坏既有解析）。
- **三档风险分级**：`readonly`（免确认）/ `reversible`（写操作，需确认）/ `destructive`（不可逆，需强确认=红色二次点击）。
- 技能仍是纯 Markdown 指令，不执行代码；命令执行是独立工具能力，受确认门控。
- 沿用：TDD verify 脚本、`npm run verify`+`typecheck`、中文 UI、本地优先、数据随 `data/`。

## 2. P0-1 Skill 安装改造

### 2.1 frontmatter 扩展与元数据自动生成

- 既有字段：`name` / `description` / `enabled`。新增可选：`triggers`（触发条件，逗号分隔字符串或 `["a","b"]` 风格文本）、`params`（参数说明文本）。解析仍按行 `key: value`，值保原文。
- 元数据自动生成（缺省时）：
  - `name` 缺省 → 取文件名（去扩展名）slug 化：小写、非 `[a-z0-9-]` 转 `-`、压缩连续 `-`、截 40；slug 后仍非法 → 报错条目
  - `description` 缺省 → 取 `triggers`；再缺省 → 正文首个非空行（去 Markdown 标记）截 300 字
  - `enabled` 缺省 `true`（既有语义不变）
- 既有的「name 必须与目录名一致，不一致以目录名为准」语义在**安装时**处理：安装写入目录 = 采用最终 name。

### 2.2 安装接口（两步式：预检 + 提交）

`POST /api/skills/import`：

- 请求：`{ items: [{ path: string, content: string }], resolutions?: Record<string, "overwrite"|"rename"|"skip"> }`
  - `path` 为上传时的相对路径（如 `my-skills/plan.md`），用于批量导入的来源展示与重命名派生
  - 单文件上传 = items 长度 1；文件夹上传 = 前端递归收集全部 `.md`
- 预检（无 resolutions）：逐项解析 → 分类 `ok`（可直接装）/ `conflict`（目标 name 已存在，含现有技能摘要 name/description）/ `error`（解析失败原因）。存在 conflict 时返回 `409 { ok, conflicts, errors }`；无 conflict 直接安装返回 `200 { installed, errors }`
- 提交（带 resolutions）：按每项决策执行——`overwrite` 覆盖写入（保留原 enabled）；`rename` 自动派生新名（`name-2`、`name-3`…取首个空位）；`skip` 跳过。返回 `200 { installed, renamed, skipped, errors }`
- 服务端实现复用 `writeSkill` / `parseSkillFile`；解析阶段生成最终 name 后查重（`listSkills` 或目录存在性）

### 2.3 对话内安装（Agent 工具）

- `create_skill { name, description, body, triggers? }`：模型生成完整技能内容并注册（= `writeSkill`）。name 非法/冲突 → 错误文本回喂（含现有同名摘要，模型转达用户决策）；参数 `overwrite?: boolean` 显式覆盖。
- `install_skill { source_id, name?, overwrite? }`：读取资料库某 md/文本资料全文（复用 read_source 的 chunks 拼接）→ 按 2.1 规则解析/生成元数据 → 安装。缺 frontmatter 的纯 md 也能装（正文=全文，元数据自动生成）。冲突未带 overwrite → 回喂冲突提示（模型询问用户后带 overwrite 重试）。
- 两个工具均挂 `TOOLS`（chat）；ask 不挂（解题场景不需要）。

### 2.4 Skill 管理 UI（设置页「技能」Tab 增强）

- 上传安装：「上传 .md」按钮（多选文件）+「上传文件夹」按钮（`webkitdirectory`）+ 支持把 .md/文件夹拖入 Tab 区；前端递归读取（`webkitGetAsEntry` 遍历目录；`webkitdirectory` 输入取 `webkitRelativePath`）
- 冲突弹窗：列出冲突项（新旧 name/description 对照），每项三选一（覆盖/重命名/跳过），可"全部同此操作"；确认后带 resolutions 二次提交
- 详情视图：点卡片展开/查看完整元数据（名称/描述/触发/参数/来源路径/正文）；「重新加载」按钮（重扫目录刷新列表——文件即真源，重载=确认最新文件状态并刷新）
- 既有启停/编辑/删除保留；删除仍走二次确认

## 3. P0-2 Agent 文件工具

### 3.1 工作区

- root 解析：`settings.workspacePath ?? (process.env.IFCOPE_WORKSPACE_DIR ?? path.join(process.cwd(), "data", "workspace"))`；启动/首用时确保存在
- `src/lib/agent/workspace.ts`：`workspaceRoot()` / `resolveInWorkspace(p)`（白名单正则前置 + resolve 前缀检查，返回相对路径统一用 `/` 分隔）/ `listFilesTree(root, depth)` 
- 系统提示注入 `<workspace>` 段：root 相对路径 + 文件树摘要（深度 2、上限 80 条、超量 `…共 N 项`）+ 项目配置（见 3.4）

### 3.2 文件工具（均挂 TOOLS，风险分级进 TOOL_RISK）

| 工具 | 参数 | 行为 | 风险档 |
|---|---|---|---|
| `list_files` | `path?` | 列目录（名称/类型/大小/修改时间），上限 200 条 | readonly |
| `read_file` | `path, offset?, limit?` | 按行读，带行号，每行截 500 字符，总量截 24k，超量提示续读参数 | readonly |
| `write_file` | `path, content` | 建中间目录后整写；覆盖已有文件需 `overwrite: true`，否则错误回喂含原文件首 20 行 | reversible |
| `edit_file` | `path, old, new, replace_all?` | 精确文本替换（唯一匹配才替换；`replace_all` 支持多处）；无匹配 → 错误回喂 | reversible |
| `search_code` | `query, glob?, regex?, case_insensitive?` | 工作区内 grep；`glob` 过滤（如 `**/*.ts`）；输出 `path:行号:行文本`，上限 100 条 | readonly |
| `run_command` | `command, timeout_ms?` | 见 §4.3 | 动态分级 |

- 全部工具抛错/回喂沿用既有 executor 机制；TOOL_POLICY 补超时：文件类 10s、search 15s、run_command 30s（可参数覆盖至 120s 上限）。

### 3.3 工作区 UI（工作台·资源栏视图切换）

- 资源栏顶部切 Tab：「资料库」（现状）/「工作区」（新）
- 工作区视图：文件树（目录展开/收起、点击文件 → 右侧预览/编辑，复用 `CodeEditor`/`Markdown`）、新建文件/文件夹、上传文件（拖拽到树=保存到对应目录）、下载文件、删除（二次确认）
- 预览/编辑接口：新增 `/api/workspace/file` GET（读，含 isDir 列表）/ PUT（写，带 expectedOld 可选做冲突提示）/ DELETE（二次确认由 UI 把关）；文件类型渲染复用现有 PreviewPanel/Markdown 逻辑

### 3.4 项目级配置自动加载

- 工作区存在 `.ifcope/AGENTS.md` → 内容注入 system prompt `<workspace>` 段尾（截 2000 字符），每次请求实时读取
- 设置页「模型接入」Tab 增加「工作区路径」配置项（空=默认），改路径即时生效

## 4. P0-3 三档确认安全底座

### 4.1 工具风险分级

- `src/lib/agent/confirm.ts`：`TOOL_RISK: Record<string, "readonly"|"reversible"|"destructive">`，`classifyTool(call) → "readonly"|"reversible"|"destructive"`（run_command 按命令内容动态判，见 4.3）
- 设置项 `confirmMode`: `"writes"`（默认：reversible+destructive 需确认）/ `"all"` / `"none"`（全自动，UI 明示风险）

### 4.2 确认流（真实时序，非占位）

1. agent 循环命中需确认的工具 → yield `confirm` 事件 `{ callId, name, args, risk, detail }` → 服务端将调用挂起（`pendingConfirmations: Map<callId, {resolve, timer}>`，60s 超时自动拒绝并回喂"学生未确认"）
2. ChatPanel 渲染确认卡片：工具名/参数摘要/风险档样式（reversible 中性蓝、destructive 红色+文案「此操作不可逆」）+「允许」「拒绝」按钮（destructive 需两次点击，第二次文案「确认执行」）
3. 用户点击 → `POST /api/agent/confirm { callId, approve }` → 挂起的 promise 解除 → 工具照常执行或回喂"学生拒绝了本次操作"
4. 会话中断/刷新：挂起项 60s 超时自动拒绝，无死锁

### 4.3 run_command 受限执行

- 执行：`node:child_process` execFile/cmd，`cwd` = 工作区 root，超时默认 30s（参数可至 120s），stdout/stderr 合并截断 20k（超量注明截断）
- **硬拒绝**（直接错误回喂，不给确认）：`rm -rf /`、`format`、`mkfs`、`reg add/delete`、`sudo`、`> /dev/`、`dd if=`、`shutdown`、`taskkill`、`del /f /s`、含 `..` 逃逸路径写入等（黑名单正则表进 verify 测试）
- **强确认（destructive）**：其余写类/删除类命令（含 `rm`/`del`/`git push`/`git reset`/`npm install` 等）
- **免确认（readonly）**：只读命令白名单（`ls`/`dir`/`cat`/`type`/`pwd`/`git status`/`git log`/`git diff`/`grep`/`find`/`node -v`/`npm -v`/`wc`/`head`/`tail`/`echo`）
- 分级函数 `classifyCommand(cmd)` 纯函数进 verify

## 5. P0-4 会话 · 模型 · 参数

- **会话重命名**：`PATCH /api/chat { threadId, title }`（截 60 字）；UI 线程列表项双击编辑/右键菜单「重命名/删除」
- **模型配置档**：settings 表新增 JSON 列 `profiles`（`[{ name, baseUrl, apiKey, chatModel, temperature, maxTokens }]`）+ `activeProfile`（档名）；既有单档字段继续作为"当前档"的物化（切换档=写回 baseUrl/apiKey/chatModel 等，兼容全部现有读取点）
- **参数**：`settings.temperature` / `settings.maxTokens`（可空=不传，走模型默认）；`streamChat`/ask 等请求体注入
- **设置 UI**：「模型接入」Tab 增：配置档下拉（新建/切换/删除档）、temperature 滑杆（0~2）、maxTokens 数字框
- 既有 API Key 遮罩语义不变

## 6. 错误处理（P0 部分）

- 工具错误回喂文本统一前缀 `工具执行失败：…`（既有），新增错误分类到提示：路径越界→"路径超出工作区"；文件不存在→含相近文件名建议（search_code 建议）
- 确认超时/拒绝 → 回喂文本明确告知模型"学生未确认/已拒绝，换方案或询问学生"
- 网络失败/模型超时：沿用退避重试+断流续跑（既有），不再新增

## 7. P1 规格（2026-11-12 细化，本批实施）

> 范围裁定（对原纲要的两处裁剪）：①工作区打包下载（zip）不做——零依赖约束下自写 zip 收益低，留 P2/引入依赖后做；②容器级强沙箱不做——Windows 本地应用不适用，改为「命令策略收紧」（三档 commandPolicy + 子进程环境变量清理 + ANSI 清洗）。

### 7.1 diff 确认卡与编辑器 diff
- `src/lib/agent/diff.ts`：`lineDiff(oldText, newText): DiffLine[]`（LCS 行级，type: same/add/del，带行号）；`formatDiff(lines, maxLines?)` 统一格式
- 写工具确认卡增强：edit_file 显示 old→new 行级 diff 小窗；write_file 显示新增内容摘要（前 10 行+总行数）
- 预览/编辑器：草稿态新增「对比」开关，原内容 vs 草稿行 diff（复用 lineDiff，客户端纯函数）

### 7.2 会话分支/回滚
- `POST /api/chat/branch { threadId, beforeMessageId }`：复制该消息及之前的全部消息到新 thread（标题加「（分支）」）→ `{ newThreadId }`
- `POST /api/chat/truncate { threadId, fromMessageId }`：删除该消息之后的全部消息（checkpoint 回滚）
- UI：消息悬停菜单「从此分支」/「回滚到此处」（回滚=不可逆，红色二次确认）

### 7.3 长任务自愈
- executor 重试策略：write_file 同参重写幂等 → 开启重试 1 次；edit_file/move 类仍不重试
- 断流续跑 2 → 3 次；错误回喂统一模板含分类与建议（见 7.4）

### 7.4 统一错误处理
- `src/lib/agent/errors.ts`：`classifyError(msg): "network"|"timeout"|"validation"|"denied"|"unknown"`；`friendlyError(kind, msg): string`（统一前缀+修复建议）
- 工具失败回喂与 UI 错误条（ErrorBanner：分类色/图标/建议文案）均走该模板；接入 ChatPanel/设置页/工作区树

### 7.5 沙箱强化（命令策略收紧）
- settings `commandPolicy`: `normal`（默认，现状）/ `readonly`（仅白名单只读命令）/ `off`（禁用 run_command）；classifyTool 先查 policy，违者 deny
- run_command 子进程环境变量白名单（PATH/SystemRoot/TEMP/TMP/HOME/USERPROFILE 等）；输出 ANSI 转义清洗（stripAnsi 纯函数）
- 设置页「安全」小节加 commandPolicy 三选（附风险说明）

### 7.6 验收（P1）
1. verify-diff-fn / verify-error-fn 全过 + `npm run verify && npm run typecheck` 全绿（verify 链扩至 10 个）
2. edit_file/write_file 确认卡显示真实 diff/内容摘要；拒绝后不落盘
3. 编辑器「对比」显示行 diff；保存后 diff 清空
4. 从消息分支出新会话（历史截断正确）；回滚到此处删除后续消息（强确认）
5. write_file 首次失败（如目录被占）时自动重试一次；错误提示带分类与建议
6. commandPolicy=readonly 时写类命令被拒；off 时 run_command 整体拒绝；输出无 ANSI 乱码

## 8. 验收标准（P0）

1. `npm run verify`（新增 verify-workspace-fn / verify-confirm-fn / verify-skill-import 至少 3 个脚本）+ `npm run typecheck` 全绿
2. 上传单个 .md（含/不含 frontmatter）→ 自动解析元数据并安装；上传含多个 .md 的文件夹（含嵌套子目录）→ 逐个安装；制造同名冲突 → 弹窗逐项选覆盖/重命名/跳过 → 结果正确
3. 对话里说"帮我创建一个错题分析技能" → 模型调 create_skill 生成完整 SKILL.md 并注册，设置页可见、load_skill 可用；把上传的 md 资料说"装成技能" → install_skill 完成注册
4. 对话里让助手读/改/建工作区文件、搜索代码 → 对应工具真实生效；写文件弹确认卡，拒绝后不落盘
5. run_command：只读命令直接跑；写类命令弹强确认；黑名单命令直接拒绝
6. 会话重命名生效并持久化；切换模型配置档后对话走新档；temperature/maxTokens 实际传给上游
7. 工作区 `.ifcope/AGENTS.md` 内容出现在系统提示并影响回答
