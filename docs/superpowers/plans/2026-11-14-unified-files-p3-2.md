# 统一文件空间 P3-2（UI 单树）Implementation Plan

> Spec: 同前 spec §5/§8-P3-2。执行 Native，延续"开工"授权。

**Goal:** 两个文件列表收敛为一棵树：新 FileTree 组件（筛选条/徽标/行操作/勾选）、上传弹窗路径+开关、对话勾选换数据源。

**关键映射决策（ledger）**：类目=文件夹——移动类目即移动文件（`category_id` 与 path 目录同步）；树按 path 分组展示；AI 归类工具（move_source）改为同时移文件。

## Tasks

### T1: FileTree 组件（数据+筛选+行操作）
- Create `src/components/FileTree.tsx`：拉 `/api/files/tree`；筛选条（全部/📚已入库/类型：笔记·课件·代码·其他/目录下拉）；行（文件夹展开、文件徽标 📚N块/未入库、类型图标）
- 行操作（悬停）：预览（复用 openSource/openWsFile 现有函数，经 props 传入）、📚 开关（POST /api/sources/:id/index）、下载（GET /api/preview/:id?download? 或 workspace download）、删除（二次确认 → DELETE /api/sources/:id 或 workspace file）
- 勾选框：仅已入库文件显示（选中=sourceIds 进对话上下文，复用 useLibrary selected 语义）

### T2: 接入 page.tsx / FilesPanel 替换
- FilesPanel 内容区换 `<FileTree />`（保留头部搜索/上传入口）；资料库/工作区 tab 移除（单树）
- move_source（AI 工具）与拖拽移动：移动=把文件移到目标类目对应目录+更新 category_id（`moveSourceFile(id, categoryId)` 共用）
- 对话勾选/拖入对话框逻辑接到树数据源

### T3: 上传弹窗 + 收尾
- UploadModal 加「保存到」（目录下拉，缺省 资料/）与「自动入库」勾选；文本/粘贴/链接同语义
- 冒烟：单树浏览/筛选/开关/预览/删除/上传两态/移动类目移文件/对话勾选引用；终审+报告

## Review Focus
1. 勾选与检索链路不回归（selected sourceIds → /api/chat 正常引用）— T2 冒烟
2. 移动类目=移文件的双写一致性（文件动、category_id 动、path 更新、索引跟随重建）— T2
3. 二进制/链接类资料在树中的行操作可用性 — T1
