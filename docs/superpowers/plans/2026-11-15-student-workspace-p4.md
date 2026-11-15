# 学生化改造 P4（OpenFic 对齐）Implementation Plan

> Spec: `docs/2026-11-15-OpenFic架构分析与学生化改造方案.md`（定稿决策见 §〇）。执行 Native，"审阅通过，开工"授权。

**Goal:** 项目=自由工作空间的四栏新壳：项目数据层 → 布局骨架 → 模块搬家 → 项目锚定。

## Global Constraints
- 项目=顶层目录（延续 P3"位置=路径"）；无模板；创建只填名称/描述
- 对话域：工作对话=threads 全局共享（`threads.project_id` 归属创建项目不可改）；解题对话=地图 QA 链（现状独立，保持）
- 迁移幂等（project_id IS NULL 过滤）；向量块不动
- 每任务 verify+typecheck 全绿+commit；新增 verify-project-fn.mjs（项目=目录派生/归属推导纯函数）

## Tasks

### P4-1 项目数据层（本批）
- T1 `projects` 表+CRUD API：POST 创建（标题必填→建顶层目录）、GET 列表（统计 N 资料/M 产物）、PATCH、DELETE（删目录+文件+级联清归属，destructive 语义）；`src/lib/project.ts`（`projectDirName(title)` 清洗/去重纯函数+`deriveProjectFromPath(path)`）+ verify-project-fn
- T2 归属列+迁移：sources/artifacts/threads 加 project_id；`migrateProjects()`（顶层目录→projects 记录；path 前缀派生归属；平铺旧文件→「未分配」sentinel 项目）+ `/api/projects/migrate` 幂等
- T3 threads 归属：新建会话挂当前项目（body projectId）；GET 列表带 project_id
- T4 冒烟收尾

### P4-2 布局骨架
- 导航轨（项目/解题答疑/文献翻译+最近项目槽+⚙设置）＋路由重组（/projects 网格、/projects/:id 项目视图）＋项目管理页

### P4-3 模块搬家
- 项目视图（FileTree+PreviewPanel+ChatPanel 三栏）；解题答疑页（全局地图列表+多选检索范围）；文献翻译页；工作台/资料模块下线

### P4-4 项目锚定+验收
- system prompt `<project>` 注入+RAG/文件工具项目范围；threads 归属展示；逐项验收+终审

## Review Focus
1. 迁移幂等/「未分配」兕底/顶层目录升级不丢文件 — T2
2. 删除项目=删目录的破坏性确认与级联正确 — T1
3. 项目=目录双写一致（标题改名≠改目录？裁定：标题与目录解耦，目录名=创建时定，改名不动目录） — T1
4. threads 归属不破坏现有会话（历史→未分配） — T3
5. 文件树/检索的项目过滤与全局共享历史共存 — P4-4
