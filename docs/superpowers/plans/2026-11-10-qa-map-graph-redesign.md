# 知识地图图化与语义连线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识地图从树改纯 DAG（汇聚/兄弟连线/双向连线），连线弹窗填词，路由+标注合并为 `map_link` 一次调用并产出内容型标注。

**Architecture:** `qaMapTypes.ts` 引入独立边表 `QaMapEdge[]`（节点去 parentId，旧数据自动迁移）；`EdgesOverlay`/`solve/page.tsx` 改按边 id 操作；`ask/route.ts` 的 `decideParent`+`describeRelation` 合并为 `decideLinks`（一次调用返回多条连线+内容型标注）；`map_router`/`map_rel` 换成 `map_link` 一个 Prompt key。

**Tech Stack:** Next.js 15 / TypeScript / @xyflow/react（仅画布）/ verify 脚本（裸 Node）+ `npx tsc --noEmit`。

**Spec:** `docs/superpowers/specs/2026-11-10-qa-map-graph-redesign.md`

## Global Constraints

- 零回归：问答/引用标注/追问按钮/卡片拖拽缩放/多地图/导入导出照旧；`tsc` 通过。
- 旧地图数据**自动迁移**：有 `parentId` 无 `edges` 的 JSON 导入时逐节点生成边（标注从 `relParentEnd`/`relChildEnd`/`relation` 搬到 `relFrom`/`relTo`）；迁移只增边不改节点内容。
- 同向边去重（`from→to` 唯一）；反向允许；连线防环（`hasCycle` 拒绝并提示）。
- `map_link` 输出 `links` 上限 3 条；`to` 不在卡片表即丢弃；温度 0。
- 标注格式「关系类型：内容特征」（类型 2-4 字 + 内容 6-14 字点名概念）；**禁止**纯「追问/延伸/相关/依据」词（提示词硬规则）；生成失败不显示标注（无 fallback 灌水）。
- 标注徽标截 20 字、悬停全文；标注为空只画线不渲染徽标。
- `ancestorChain` 多父取祖先并集去重、上限 8 条（取 round 较新的优先）。

## Review Focus

1. **旧数据迁移损坏** — 旧格式（parentId/relParentEnd/relChildEnd/relation）导入后边与标注完整、往返导出导入无损 → Task 1 verify 断言旧格式迁移 + normalize 幂等。
2. **多入边后追问上下文爆炸/重复** — ancestorChain 并集去重、上限 8 → Task 1 verify 断言菱形图（A→B,A→C,B→D,C→D）中 D 的祖先为 {A,B,C} 无重复。
3. **map_link 幻觉连线** — links 的 to 不存在/超 3 条 → Task 2 实现里校验丢弃；手动验收"综合两分支"场景只连对的。
4. **边 id 唯一性** — 手动/AI 建边 id 冲突（`from->to` 复用）→ Task 1 verify 断言 `edgeId` 稳定唯一、重复导入去重。
5. **渲染多线穿卡/标注挤压** — 目标在源左侧时锚点换边、空标注无徽标 → Task 3 手动验收。

---

### Task 1: 图数据层（QaMapEdge + 迁移 + 纯函数，TDD）

**Files:**
- Modify: `src/lib/qaMapTypes.ts`
- Create: `scripts/verify-qa-map-graph.mjs`

**Interfaces:**
- Consumes: 无
- Produces（后续任务依赖）:
  - `type QaMapEdge = { id: string; from: string; to: string; relFrom?: string; relTo?: string }`（`relFrom`=目标卡相对源卡的关系，显示在源端；`relTo`=源卡相对目标卡，显示在目标端）
  - `type QaMapNode`：**删除** `parentId`/`relation`/`relParentEnd`/`relChildEnd` 字段
  - `type QaMapData = { title: string; nodes: QaMapNode[]; edges: QaMapEdge[] }`
  - `edgeId(from: string, to: string): string` → `` `${from}->${to}` ``
  - `ancestorChain(nodes: QaMapNode[], edges: QaMapEdge[], nodeId: string | null): QaMapNode[]`（入边并集向上、去重、上限 8，round 大者优先保留）
  - `nextNodePosition(nodes: QaMapNode[], edges: QaMapEdge[], sourceId: string | null): { x: number; y: number }`（源卡右侧，按同源出边数纵向堆叠；无源走最右开列）
  - `hasCycle(nodes: QaMapNode[], edges: QaMapEdge[], from: string, to: string): boolean`（加 `from→to` 后是否成环）
  - `normalizeQaMap(raw: unknown): QaMapData | null`（双格式：旧 parentId 自动迁移；新格式校验边、去重、丢悬空边）
  - `qaMapToMarkdown(map: QaMapData): string`（改为按边输出树形——每节点取第一条入边为树边做缩进，其余入边以「→ 关联至《标题》（标注）」附注）

- [ ] **Step 1: 写失败验证 `scripts/verify-qa-map-graph.mjs`**，断言：
  1. 旧格式迁移：`{title, nodes:[{id:"a",parentId:null,...},{id:"b",parentId:"a",relParentEnd:"深入",relChildEnd:"依据",x,y,question,answer}]}` → `normalizeQaMap` 返回 `edges:[{from:"a",to:"b",relFrom:"深入",relTo:"依据"}]`，节点无 parentId；再 `normalizeQaMap(JSON.parse(JSON.stringify(out)))` 幂等（edges 数量不变）；
  2. 同向去重/反向保留/悬空丢弃：edges 含重复 `a->b`×2、`b->a`、`a->missing` → 剩 `a->b`+`b->a`；
  3. `ancestorChain` 菱形：a→b,a→c,b→d,c→d，`ancestorChain(...,"d")` = [a,b,c]（去重、含共同祖先一次）；
  4. `ancestorChain` 上限：8 条链式节点全取；12 条链只取最近 8 个祖先（不含自身）；
  5. `hasCycle`：a→b,b→c 时 `hasCycle(c→a)` true、`hasCycle(a→c)` false；
  6. `edgeId("a","b") === "a->b"`；`nextNodePosition` 有源时 x > 源卡右缘。

- [ ] **Step 2: 运行确认 FAIL**（ERR_MODULE_NOT_FOUND）

- [ ] **Step 3: 实现 `qaMapTypes.ts` 改造**：按 Produces；`normalizeQaMap` 先判旧格式（任一节点有 `parentId` 字段且无 `edges`）走迁移分支，否则走新格式校验分支。

- [ ] **Step 4: 运行确认 PASS**：`node scripts/verify-qa-map-graph.mjs` → `verify-qa-map-graph: all pass`；`npx tsc --noEmit` 此步**允许报错**（下游 solve/page.tsx、EdgesOverlay.tsx、ask/route.ts 还引用旧字段——Task 3/4 消化；用 `npx tsc --noEmit 2>&1 | grep -c qaMapTypes` 确认错误都源于旧字段引用即可）。

- [ ] **Step 5: Commit** `feat(qa-map): 图数据层——QaMapEdge 边表 + 旧数据迁移 + 纯函数`

### Task 2: `map_link` 提示词 + ask 路由合并（一次调用多连线）

**Files:**
- Modify: `src/lib/prompts.ts`（`PROMPT_DEFAULTS`/`PromptKey`）、`src/app/api/ask/route.ts`

**Interfaces:**
- Consumes: Task 1 的 `QaMapEdge`/`ancestorChain`
- Produces:
  - `PromptKey` 变更：删 `map_router`/`map_rel`，加 `map_link`（`PROMPT_DEFAULTS.map_link` 为合并后提示词，内容型标注规则写死在内）
  - `decideLinks(q: string, nodes: QaMapNode[], forcedTo?: string): Promise<{ to: string; relFrom: string; relTo: string }[]>`（替换 `decideParent`+`describeRelation`；forcedTo=追问场景固定连线目标；上限 3 条、to 校验、温度 0）
  - ask/route.ts 响应 `node` 旁新增 `links: QaMapEdge[]`（本次建的边，前端落进 edges）

- [ ] **Step 1: `PROMPT_DEFAULTS` 换 key**：`map_link` 提示词 = 角色说明（知识连线判断器）+ 输入格式（新问题+卡片表含回答摘要）+ 输出 JSON `{"links":[{"to":"id","relFrom":"…","relTo":"…"}]}` + **内容型标注硬规则**（格式「类型：内容特征」、类型 2-4 字/内容 6-14 字点名概念、基于回答内容提炼、禁止纯「追问/延伸/相关/依据」、可为空 links）；PromptKey 类型与设置页 key 列表同步（`PROMPT_LABELS` 在 PersonalSection.tsx：map_link→「知识连线」，删两项）。

- [ ] **Step 2: 实现 `decideLinks`**（复用现有 fetch 模式；输入卡片给 `id｜标题｜问题｜回答摘要 80 字`；解析 JSON 时 content+reasoning 合并找 JSON（现逻辑保留）；过滤：to 不存在丢弃、slice(0,3)、relFrom/relTo 各截 20 字、非空校验——标注不合规（纯通用词正则 `/^(追问|延伸|相关|依据|关联)$/`）置空串）。

- [ ] **Step 3: 主流程改造**：`parentId` 逻辑改 `links`（显式 parentId → `decideLinks(q, nodes, parentId)`；未指定且地图非空 → `decideLinks(q, nodes)`；空地图/无 links → 不连）；`ancestorChain(map.nodes, map.edges, links[0]?.to ?? null)` 取上下文；节点落库后 `links` 转 `QaMapEdge[]`（`edgeId` 生成）并入 `map.edges`；响应带 `links`。

- [ ] **Step 4: 验证**：`npx tsc --noEmit`（Task 3/4 未做的旧引用错误仍允许，确认无 prompts/ask 相关新错）；`node scripts/verify-personal-store.mjs` 通过（PROMPT_DEFAULTS key 变更不破坏该脚本——其断言含 5 旧 key 的部分需同步改 4 新 key，**在本步一并更新该断言**）。

- [ ] **Step 5: 手动冒烟**（dev server + 真模型）：已有两分支的地图上问"综合 A 和 B 的结论"→ SSE/响应 `links` 出现 2 条、标注为内容型（点名概念）。

- [ ] **Step 6: Commit** `feat(qa-map): map_link 合并路由+标注——一次调用多连线、内容型标注`

### Task 3: EdgesOverlay 边表渲染

**Files:**
- Modify: `src/components/qa-map/EdgesOverlay.tsx`

**Interfaces:**
- Consumes: Task 1 的 `QaMapEdge`/`edgeId`
- Produces: `EdgesOverlay` props 变更：`{ nodes, edges, selectedEdgeId, onEdgeClick(edgeId, end) }`（edgeId 替代 childId）

- [ ] **Step 1: 改边来源**：`edges` prop（`QaMapEdge[]`）替代从 parentId 派生；`byId` 查 from/to 端点；悬空边跳过。
- [ ] **Step 2: 锚点方向**：目标在源右侧（`b.x > a.x`）用 右中点→左中点；否则 反向锚点（左中点→右中点）+ 箭头方向相应旋转，线不穿卡。
- [ ] **Step 3: 标注徽标**：挂 `edgeId`；`relFrom`/`relTo` 空则该端不渲染徽标；文本截 20 字 + `title` 悬停全文；`onEdgeClick(edgeId, end)` 上抛。
- [ ] **Step 4: 验证**：`npx tsc --noEmit` 相关错误清零（solve/page.tsx 若未改完可余留——Task 4 消化）；手动验收：A→B 与 A→C 两线共存、B→A 反向线共存、空标注只画线。
- [ ] **Step 5: Commit** `feat(qa-map): 边表渲染——多线共存/双向/空标注`

### Task 4: solve 交互（EdgeDialog + 边编辑 + 追问）

**Files:**
- Modify: `src/app/solve/page.tsx`
- Create: `src/components/qa-map/EdgeDialog.tsx`

**Interfaces:**
- Consumes: Task 1 纯函数、Task 2 响应 `links`、Task 3 的 `onEdgeClick(edgeId, end)`
- Produces: 无后继

- [ ] **Step 1: 状态模型改造**：`QaMapData` 三处持久化点（建图/保存/导入）改带 `edges: []`；`selectedEdge` 状态从 `{childId, end}` 改 `{edgeId, end, draft}`。
- [ ] **Step 2: `EdgeDialog` 组件**：props `{ nodeFrom, nodeTo, onCancel, onConfirm(relFrom, relTo) }`；两卡标题 + 两个输入框（源端标注「目标卡相对源卡」/目标端标注，可留空）+ 确定/取消；Esc 关闭。
- [ ] **Step 3: `onConnect` 改造**：`hasCycle` 防环（成环 toast「会形成循环，已拒绝」）；同向重复（`edgeId` 已存在）toast 拒绝；否则弹 `EdgeDialog`，确认后追加边并保存。
- [ ] **Step 4: 边编辑面板改造**：按 `edgeId` 查边；输入框 placeholder 改「关系标注（如：前提：线性时不变假设）」；应用=更新该边 `relFrom`/`relTo`（点哪端改哪端）；断开=删该边。
- [ ] **Step 5: 追问改造**：`onFollowUp` 仍传 `parentId`（API 内部改 `forcedTo` 语义）；响应 `links` 落入 `edges`（去重）；节点落位 `nextNodePosition(nodes, edges, sourceId)`。
- [ ] **Step 6: 验证**：`npx tsc --noEmit` **全绿**；`node scripts/verify-qa-map-graph.mjs` + `verify-personal-store.mjs` 通过；手动验收（规格 §8 条 1/2/4/5：三入边汇聚、兄弟互连/双向共存、弹窗填词、断开/改词、成环拒绝、旧图导入迁移、追问连线自动标注）。
- [ ] **Step 7: Commit** `feat(qa-map): 连线弹窗填词 + 边编辑按边 id + 追问图化`

### Task 5: 全量回归 + 验收

**Files:** 无新改动（验收发现问题按 systematic-debugging 修复）

- [ ] **Step 1: 全套自动化**：`npx tsc --noEmit` + `verify-qa-map-graph` + `verify-personal-store` + `verify-agent-core` + `verify-context-fold` + `verify-revproxy-fn` + `verify-todo-store` 全绿。
- [ ] **Step 2: 手动验收**（规格 §8 逐条 + Review Focus 五条）：重点 3——AI「综合两分支」一次建 2 条边且标注点名概念；旧地图导入边/标注完整、导出再导入无损；菱形图追问上下文含三祖先无重复。
- [ ] **Step 3: Commit（如有修复）** `fix(qa-map): 图化验收修复`
