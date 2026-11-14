# 统一文件空间 P3-1（存储统一）Implementation Plan

> 执行：Native（本会话）。Spec: `docs/superpowers/specs/2026-11-14-unified-file-tree-design.md` §2/§3/§6/§8-P3-1。
> 用户已明确"审阅通过，开工"，计划不再另设审批门（ledger 记录）。

**Goal:** 单一文件树的存储层：sources.path、上传直写树、散列→树幂等迁移、索引开关、编辑联动重建索引、树数据接口。

**Architecture:** `titleToFilename` 等纯函数进 `src/lib/fileTree.ts`（verify 直测）；迁移按 `path IS NULL` 过滤幂等；所有"读资料文件"的路径统一走 `sourcePath(s)`（path 优先、旧 storage_name 兜底）。

## Global Constraints

- 零新依赖；每任务 `npm run verify && npm run typecheck` 全绿 + commit
- 文件名去重：`标题.ext` 冲突取 `标题-2.ext`…；标题清洗非法文件名字符 `\/:*?"<>|` → `_`，截 80 字
- 迁移不动文件内容 → chunks/向量不重建；迁移失败留 path=NULL 可重跑
- 编辑联动重建 = 异步 fire-and-forget（不阻塞写请求）
- 新增 `scripts/verify-file-fn.mjs`（titleToFilename/sourcePath 纯函数）挂 verify 链（→14 个）

## Tasks

### T1: 纯函数 + sources.path + 迁移
- Create `src/lib/fileTree.ts`：`titleToFilename(title, ext, taken: Set<string>): string`（清洗/去重/截断）；`sourcePath(s: { path?: string | null; filename?: string }): string`（path 优先，否则 `uploads/<filename>` 相对根的旧语义返回绝对 uploads 路径——统一由调用方 resolve）
- Create `scripts/verify-file-fn.mjs`：清洗非法字符、去重 -2/-3、截 80、sourcePath 兜底
- Modify `src/lib/db.ts`：sources 加 `path TEXT`（迁移式 ALTER，沿用既有 try/catch 迁移风格）
- Create `src/lib/fileMigrate.ts` + `POST /api/files/migrate`：`migrateUploadsToTree()` —— 对 `path IS NULL` 的 sources：读 uploads 文件 → 写 `资料/<titleToFilename>`（taken 去重）→ 更新 path；返回迁移清单；幂等
- Modify `src/app/api/preview/[id]/route.ts`：读文件改 sourcePath（path 优先）

### T2: 上传直写树
- Modify `src/app/api/sources/route.ts`：multipart/文本入库均直写目标 path（body `path?` 默认 `资料/`、`autoIndex?` 默认 true；autoIndex=false 时只落文件不解析——此时 source 记录也建（title=path）但 status='raw'？**裁定**：落文件必建 source 记录（树行需要索引开关），status=autoIndex?'processing':'skipped'，出/入库由开关管）
- Modify `src/app/api/sources/[id]/route.ts`（PUT 编辑）：按 sourcePath 读写文件（内容一致后重建索引，沿用既有语义）

### T3: 索引开关 + 编辑联动
- Create `POST /api/sources/[id]/index`：`{ on }`——on=true 且无 chunks → 按文件内容走既有解析建块管线；on=false → 删该 source 的 chunks（文件不动）
- 编辑联动：`/api/workspace/file` PUT 后查 `sources WHERE path = ?` → 命中且已入库 → 异步重建；agent `write_file`/`edit_file` case 同样联动（抽 `reindexByPath(path)` 供两处共用）
- Modify `scripts/verify-file-fn.mjs` 补 reindexByPath 的路径匹配纯逻辑断言（若纯部分可测）

### T4: 树数据接口 + 总验
- Create `GET /api/files/tree`：fs 树 + sources 元数据合并（每节点：type 推断、indexed、chunkCount、sourceId）
- 冒烟：迁移旧资料→树中出现且问答引用不变；上传 autoIndex 开/关两态；AI/接口编辑已入库文件→chunks 更新；出库后提问不引用；`/api/files/tree` 元数据正确
- 终审 + ledger + 报告

## Review Focus
1. 迁移幂等与失败恢复（重跑不重复、部分失败可续）→ T1 verify/冒烟
2. 文件名去重跨平台（大小写、非法字符、超长）→ T1 verify
3. 旧接口兼容（id 型预览/编辑在迁移后仍工作）→ T2 冒烟
4. 联动重建不阻塞写请求、失败不影响文件写入 → T3 设计+冒烟
5. 出库只删 chunks 不碰文件/向量残留 → T3 冒烟
