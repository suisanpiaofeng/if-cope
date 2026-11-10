# IF.Cope 交接文档（2026-10-23）

> 接手必读。本项目是 **iflearn-demo 的成熟重构版**（同目录演进：`iflearn-demo` → `ifcope`），
> 旧栈交接文档已删除，本文档是唯一权威。

## 1. 项目概览

- **定位**：校园 AI 学习工作站本地 Demo。用户上传学习资料 → 自动解析/分块/向量 →
  对话引用原文；围绕资料做知识加工（笔记/导图/流程图/测验/**知识地图**/**文献翻译**）。
- **技术栈**：Next.js 15 App Router + React 19 + TypeScript + Tailwind v4；SQLite(better-sqlite3)；
  FastAPI 外部服务已彻底移除，解析/嵌入/LLM 全部本地直连。
- **端口**：3777（dev 与 prod 同端口，build 前必须先停 dev）。
- **发布方式**：模块做完即实测（tsc + build + 无头 CDP 实测）→ 提交一笔 git；根目录曾拆 `feat/tailwind-redesign`
  分支（已完结合并），现全部在 main 直接小步提交。

## 2. 目录结构与分层

```
src/
├─ app/
│  ├─ page.tsx                 工作台（类目/资源/双栏对话/预览/便签模态）
│  ├─ solve/page.tsx           解题答疑·知识地图工作区（React Flow 画布）
│  ├─ translate/page.tsx       文献翻译（仅 PDF，双栏对照，多标签）
│  ├─ settings/page.tsx        设置（对话/翻译模型分接口、Key 遮罩）
│  ├─ tools/page.tsx           工具库入口（server 壳 + Suspense，主体在 components/tools/ToolsClient.tsx）
│  └─ api/                     chat sources categories artifacts settings
│                              organize(整理) ask(知识地图检索) lookup(离线网页)
│                              preview(二进制流/EPUB) translatePdf translations/[id]
│                              usage(用量探针)
├─ components/
│  ├─ qa-map/                  知识地图画布套件（QAMapCard / RelEdge /
│  │                           EdgesOverlay 自绘连线层 / SourcePreviewDrawer 抽屉）
│  └─ notes/                   便签系列渲染器（Markdown/大纲/思维导图/流程图/
│                               测验/知识地图/旧 qa-canvas 兼容渲染）
└─ lib/
   ├─ db.ts                    SQLite schema+迁移+设置+向量自愈（含 embed_dim 回写）
   ├─ modelGateway.ts          模型单出口（providers/默认链/用量归一化/重试/JSON模式/usage）
   ├─ translate.ts             翻译上游解析（translate* 逐项回退对话配置）
   ├─ pdfTranslate.ts          pdf2zh CLI 封装（spawn/超时/产物路径/下载 URL）
   ├─ qaMapTypes.ts            知识地图类型 + qaMapToMarkdown
   ├─ parse/                   file.ts pdf.ts audio.ts pptx.ts epub.ts
   ├─ localEmbed.ts            FastEmbed 单例（bge-small-zh-v1.5，**512 维**）
   ├─ webSearch.ts             时效触发判定 + DuckDuckGo/百度双源搜索 + 超时合并
   ├─ tools/registry.ts        工具库注册表（ToolDef 元数据 + 懒加载，客户端可安全 import）
   └─ embed.ts                 OpenAI 兼容 API 嵌入（优先 providers 增强链）
```

**分层铁律**：类型/纯函数放独立 `*Types.ts`（客户端可安全 import）；服务端模块
（db/fastembed）绝不被客户端组件 import；重依赖一律懒加载。

## 3. 功能模块现状

### 3.1 工作台
- 类目：**AIGC 固定不可删**（AI 自动归类落点）；`category_id NULL = 未归类`；
  子类目 `parent_id` 一级嵌套（列表 `··` 缩进）；排序 AIGC>有子类目父类>名称。
- 资源：排序按 `starred, pinned, is_primary, id`；删除级联 chunks/vectors/直存文件。
- 对话：流式 + `[n]` 引用（检索到 chunk 自动附加、零无关引用）+ 快捷功能条 +
  整理回执/用量提示（`提示:` 气泡）；**联网搜索 = agent 工具 `web_search`**（`lib/agent/tools.ts`，
  模型自主决定调用，`lib/webSearch.ts` 免 Key 抓必应，失败静默降级；解题页 `/api/ask` 另有时效性
  问题自动联网的旧逻辑，两条链路并存）。
- 预览：PDF/EPUB/音视频/图片/PPTX/Markdown(便签画布)/代码（CodeMirror 可编辑）/URL。

### 3.2 快捷功能条（原"便签"模块改造）
- 输入框上方按钮：复习笔记/思维导图/流程图/大纲/测验 → 打开生成模态；
  另有「整理资源」（不选资源 = 全部）、「解题答疑」入口。
- 生成落库 `artifacts`（category_id=NULL 专属通道，`/api/artifacts`）。

### 3.3 解题答疑·知识地图（`/solve`，本项目最重模块）
- 一问一卡一引用：`/api/ask` 问句→过滤零相关检索引用→AI 双模式生成知识卡片
  （`refNumbers` **服务端校验过滤**）；追问走 `/api/chat` + `mapId`（历史/资源/引用注入）。
- 关系词双端：每条边存 `relationAB`/`relationBA`（A→B 显示前者、B→A 显示后者），
  生成时 AI 填（双端各一个关键词），读取/导入自动补默认；两端标签可独立编辑。
- 画布：React Flow v12 + **EdgesOverlay 自绘连线层**（RF 受控模式边管道有渲染缺陷，绕开）；
  **视口自算 setViewport**（不用 fitView）；`onNodesChange` 只处理 position；
  卡片可拖动/调大小；资源框拖拽/折叠；来源可折叠（3+ 来源折叠）；
  右侧 SourcePreviewDrawer（45% 宽可关）预览 chunk 上下文原文。
- 数据：`knowledge_maps` + `knowledge_cards` 两表，`layout_json` 持久化；
  导出 JSON/MD（JSON 含 version），导入自动归一化（旧版双单字节关系词升级双端）。

### 3.4 文献翻译（`/translate`，**仅 PDF**）
- 资源框只列 `ext === "pdf"` 的文件；多选批量、多标签页、英文文献高亮。
- 引擎 = **PDFMathTranslate（pdf2zh）CLI**：产出 mono（纯译文）+ dual（原译交替双语）两份 PDF；
  存 `data/translations/<uid>/`，元数据 JSON 落 artifacts（type=translation，content.kind="pdf"）。
- 对照视图：左原版 iframe + 右 **mono 纯译文 iframe（页数与原版一致，逐页对照）**；
  两个下载按钮（译文/双语 PDF）。
- 翻译模型独立接口：设置页 translateBaseUrl/translateApiKey/translateModel 逐项回退对话配置。
- 历史文本翻译产物仍可查看/下载（渲染兼容保留）；分段文本翻译管线已删除。

### 3.5 工具库 / 设置 / 用量
- 工具库 `/tools`（42 个工具，纯本地不上传）：**registry 注册表架构**（学习 it-tools）。
  `src/lib/tools/registry.ts` 存 `ToolDef`（id/name/desc/category/keywords/懒加载 `load`），
  页面 `ToolsClient.tsx` 提供搜索（名称+关键词）/ 可折叠分类 / 收藏(localStorage) / 最近使用 /
  URL 深链 `?tool=<id>`。**新增工具 = 写一个 `src/components/tools/Xxx.tsx` + registry 加一行**；
  共享 UI 原语在 `src/components/tools/_ui.tsx`（按钮/输入/输出/复制等，统一中性灰风格）。
  每个工具 `load: () => import(...)` 独立懒加载、切换即卸载（守内存纪律）。
- 9 大分类：文本/编码/开发/数据/图片/PDF/时间/生活/安全。批1 纯 JS 零依赖（UUID/密码/Hash/进制/
  Diff/JWT/单位时区换算等），批2 轻依赖（JSON↔YAML/TOML/CSV/转代码/对比、PDF 拆分旋转转图、
  图片改尺寸/裁剪/取色、Markdown 编辑）。新增依赖仅 `js-yaml`+`smol-toml`（纯 JS，已纳入 postinstall 裁剪 sourcemap）。
- **PDF 转图片**用 pdfjs 客户端渲染 canvas，worker 走 `public/pdf.worker.min.mjs`（已随仓库）。
- 设置：**对话与翻译模型分接口**；providers 多接口（含火山 Ark v4+AK-SK 签名、
  CVStudio、New API、自定义）；用量探针四种模板 + 用量条 + 自测。

## 4. 数据模型（SQLite，better-sqlite3 WAL）

```sql
settings(key PK, value)                 -- JSON：providers、默认providerId、模型、翻译模型、usageProbe 等
providers(id PK, json)                  -- 多接口配置
sources(id, title, path, ext, mime, size, source_type, url, is_primary, starred,
        pinned, status, category_id, parent_id, file_mtime, upload_hash, ...)
        -- file_mtime：音频转写缓存校验；upload_hash：上传去重（秒传）；is_primary：会话主资源
chunks(id, source_id, seq, text)  vectors(chunk_id, dim, embedding BLOB)
conversations(id, title)  messages(id, conv_id, role, content, sources, mapId)
artifacts(id, title, kind, type, category_id, content, created_at)  -- type: note|translation；category_id NULL=专属通道
knowledge_maps(id, title, source_id, created_at)
knowledge_cards(id, map_id, question, answer, ref_numbers, x, y, width, height, created_at)
card_edges(id, map_id, from_card, to_card, relation_ab, relation_ba, created_at)
embed_meta(key PK, value)  -- embed_dim 自愈（启动时对首条向量校验，不符则重建索引+回写）
```

**删除语义**：删类目=级联删除子类目 + 资源置回未归类；删资源=级联 chunks/vectors +
删除直存文件（uploads 与 translations/<uid>/）。

## 5. 模型网关（单出口）

- `modelGateway.ts`：providers/默认链/`getActiveModel()`/`chatJson`（JSON 模式重试）/
  `chatStream` / `usage` 归一化（tokens→credits→points→dollar→raw）。
- 火山 Ark 翻译接口需 **v4 端点 + AK-SK 签名**（`X-Date` + `X-Content-Sha256`），
  签名函数内联于 lib；CVStudio 响应包 `output`。
- `webSearch.ts`：`shouldWebSearch`（时效词/年份/新闻/联网意图，且问句>8字防误触发）、
  `fetchSearchResults`（DuckDuckGo + 百度，每源超时 6s、总超时 10s，结果注成可读文本）。
  **前端触发**：仅解题答疑页问句命中且无资源时自动触发；工作台不做自动触发（走 `@联网` 手动指令）。

## 6. 文献翻译外部依赖（pdf2zh）

- **uv 工具环境**：`%APPDATA%\uv\tools\pdf2zh`，Python 3.12.13；可执行 `~/.local/bin/pdf2zh.exe`（uv shim）。
- 版面识别模型在 HF 镜像下载（`HF_ENDPOINT=hf-mirror.com`）后即可完全离线。
- 上游对接环境变量（由 `/api/translatePdf` 进程注入）：
  `OPENAILIKED_BASE_URL/OPENAILIKED_API_KEY/OPENAILIKED_MODEL/OPENAILIKED_TOKENIZER_URL`
  （回退到翻译模型配置，再回退对话模型）。
- **坏版本钉死**（升级时必看）：`tencentcloud-sdk-python-tmt==3.0.1478`（新版缺
  TextTranslateRequest 会让 `-s tencent` 路径崩，我们不用它但 import 在）；
  `bitstring==4.3.1`（5.x 删了 BitStream）。升级 pdf2zh 需回归这两个依赖与 CLI 参数。
- 无 Python/uv 时功能**优雅降级**（报错提示安装命令），其余功能不受影响。
- 产物：`data/translations/<upload_hash>/xxx-mono.pdf + xxx-dual.pdf`；
  `/api/translations/[id]?which=mono|dual&download=1` 流式（路径规范化校验在目录内）。

## 7. 内存/存储优化成果（重要背景，别回退）

- dev ≈ 3GB / **prod ≈ 198MB**：whisper 用完即释放；jszip/@audio/decode 懒加载；
  pdfjs 懒加载；工具页/导图编辑器 dynamic；d3 依赖已移除（导图编辑器原生实现）。
- onnxruntime overrides 统一 1.30（省 ~208MB 磁盘）；mermaid scripts/trim-heavy-deps.mjs
  裁掉冗余产物；npm cache 清理 3.66GB；.next/cache 清理 521MB。
- `embed_meta.embed_dim` 自愈：bge-small-zh-v1.5 实际 512 维，启动时自动校验/重建/回写。

## 8. 踩坑记录（新会话务必先看）

1. **iframe 显示 PDF 错乱（文字切碎）**：iframe UA 默认 `height:150px` 阻断 grid 拉伸，
   PDFium 对极端扁视口算分数缩放导致文字栅格切片。**必须给 iframe `h-full`**（已在
   PdfCompare/PreviewPanel 处修复）。
2. **React Flow 受控模式下"边"不渲染**（v12 静默缺陷）：改用 EdgesOverlay 用 SVG 自绘，
   绕开 RF 的边管道（节点管道正常）。
3. **fitView 对超大文档算出 scale(0.31) 黑盒**：解题答疑画布改成自算 setViewport。
4. **onNodesChange 回写 width/height 触发死循环**：只处理 position，其余字段不碰。
5. **Windows/MSYS**：heredoc 会话内不可靠（偶发静默不落盘，**用 edit/write 工具替代**）；
   `-w "\n"` 会被路径转换；杀进程用 `taskkill //PID <pid> //F`。
6. **无头 CDP 实测**：`msedge --headless=new --remote-debugging-port=9222`，页面窗口默认
   500×320，需 `Emulation.setDeviceMetricsOverride`；CDP 会话间共享（重启服务后复用）。
7. **生产模式**：build 前必停 dev；`node_modules` 重装后需 `npx next build` 重建（旧 dev 服务器不能用新 node_modules）。
8. **better-sqlite3 编译**：版本升级会触发 node-gyp 本地编译（约 2-3 分钟），失败则回退原版本。
9. **用户数据实时在变**：测试前先查 DB 现状（用户在页面上会删/加资源）。

## 9. 待办 / roadmap（下一会话从这里接）

### 9.1 课堂专区 v3（原生 UI，`classroom-v2` 分支，待真机登录校准）

**架构**（规格 `docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md`，修订 v2 D1）：原生 UI 看 CVS 回放——前端经反代 3778（带浏览器托管 Cookie）调官方接口拉目录/取流，3777 只做元数据 SQLite 落库，`<video>` 直连官方媒体直链（失败自动切 `/__h/` 代理兜底一次）；iframe 内嵌方案已彻底移除（含反代导航收敛注入）。

**已实现（2026-11-09）**：`/classroom` 三态原生页（课程卡片列表+本地搜索 → 课时表+转码灰态 → 机位播放器）；接口层 `src/lib/classroom/{types,store}.ts`（常量/字段提取器单点修）；API `courses` GET/sync/DELETE + `courses/[id]/lessons` GET/sync（同步带结构校验，不符整体拒 400 不写半包）；旧空 `classroom_*` 表启动时自动 DROP 重建为 v3 列（带 user_id，D6）；合规声明拦截/Cookie 兜底/登录态轮询沿用。CDP 冒烟 14 PASS（声明/列表/搜索/课时/灰态/服务失败横幅+缓存不丢）。

**已实证（2026-11-09，未登录直连）**：`/v1/teachingclass/list`、`/v1/subject_vod_list_new`、`/v1/course_vod_videoinfos` 三路径在真实服务器存在（返回 401 JSON 而非 404）；官方 SPA 静态资源公网可拉，接口逆向工具 `scripts/recon/scan_api.js`。

**真机联调清单（校园网 + 已登录，Task 6 未决）**：
1. **字段包裹层校准**：登录后点「同步课程」，若报「结构变化/未返回课程」，看 F12 Network 的 `teachingclass/list` 实际响应 → 改 `types.ts` 的 `extractListItems` 单点；课时表同理改 `subject_vod_list_new`。
2. **媒体直链**：点课时若「播放失败」→ 看 `course_vod_videoinfos` 返回的 url 主机名/字段路径 → 若被改名改 `extractVodViews`；若需 Referer/Cookie，确认自动切 `/__h/` 代理兜底后能否播（非 `*.seu.edu.cn` 域会被反代拦截属预期）。
3. **登录链（沿 v2 已验证结论）**：顶栏「登录 CVS」顶层窗口走 CAS；失败用 Cookie 兜底粘贴。
4. **整链验收**：登录 → 同步 → 选课 → 刷新课时 → 播放切机位 → 转码中灰态 → 杀 3778 再同步出横幅且列表在。

**运维要点**：3778 端口占用排查（`netstat -ano | grep 3778`）；Cookie 过期 = 同步/刷新报 401 →「登录 CVS」重登或 Cookie 兜底；上游卡死有 15s 超时保护（不会永久转圈）。

**AIGC 目录已移除（2026-11-04）**：不再有固定的 AIGC 类目；所有产物（笔记/知识地图/翻译）默认落「未归类」，可拖入任意类目。db.ts 启动时自动迁移（解散 pinned=1 或名为 AIGC 的类目：内容回未归类、子类目提顶级、删行）。PDF 译文更进一步：直接入库为资源（type=翻译，与原文同类目），不再造产物行，历史由翻译页从资源推导（兼容旧产物）。getAigcCategoryId 函数已删除。译文资源带 origin_id 列（指向原文 id）：翻译页资源栏显示全部 PDF（已译带✓绿标、批量翻译自动跳过）；历史翻译仅本页显示，点击打开原文↔译文对照（无 origin 关联的旧数据回退单栏）。

**资源栏统一（2026-10-30）**：第二栏数据/操作单点在 `src/lib/useLibrary.ts`（取数、勾选、上传/链接/文本、删/建/移类目、拖拽移动），工作台/翻译/解题三页共用；`FilesPanel` 加视图 props（传入预过滤数据 + `topSlot/bottomSlot/topBarExtra` 插槽 + `sourceMeta/sourceBadge/sourceRowClass` 行级定制）。翻译页视图=仅 PDF（蓝色左界+🌐 高亮疑似英文），解题页视图=仅 ready（地图管理挂 topSlot，勾选集即问答依据）。改资源栏只动这两处，三页同时生效。

**已知行为**：FTS 为 trigram 分词，查询词需 ≥3 字符（2 字查询不命中是既有设计，非 bug）。

### 9.2 其他待办

2. 音频转写缓存的**旁路**已实现（file_mtime 校验），上传去重（upload_hash 秒传）已实现。
3. 便签系列旧渲染器（Markdown/大纲/导图/流程图/测验）仅服务于历史产物，新功能勿再扩展。
4. 知识地图：用户反馈“拖动跟手/闪烁根治”需真机确认；连线层可再加箭头/虚线样式。

## 10. 验证方式（改完代码必跑）

```bash
npx tsc --noEmit          # 类型
npm run build             # 构建（先停 dev）
npm run start &           # 生产模式
# 无头 CDP 冒烟（页面加载/console error/关键交互），参考 §8.6
```

提交规范：每模块完成后**实测通过**再 commit（`feat(x):` / `fix(x):` / `perf(x):`），
提交前 grep 确认无调试残留（`console.log`/`debugger`/`_diag`）。
