# IF.Cope 桌面化与本地数据目录 · 架构规格（2026-11-10）

> 状态：**待用户评审**。评审通过后进入 writing-plans 拆实施计划。
> 用户决策（2026-11-10）：**Electron 壳；整个数据目录自选（数据库/文件/模型统一放用户指定文件夹）；文件集中管理 + 存在自己的文件夹；暂不做多设备访问**。
> 定位：IF.Cope 已是本地应用（数据在 `data/`、服务在 localhost），本规格解决「包装成本地软件」+「数据目录自选」+「文件集中管理」，功能代码基本不动。

## 1. 背景与目标

现状：`next dev/start -p 3777` 起服务，数据硬编码 `process.cwd()/data/`（7 处），浏览器访问 localhost 使用。问题：

1. 没有「软件感」——要开终端、开浏览器，无独立窗口/托盘；
2. 数据目录绑死在程序目录——重装/升级程序会碰到数据，用户无法把数据放 D 盘、网盘同步目录；
3. 文件分散——上传件、翻译产物、备份散在 `data/` 各子目录，应用内没有统一查看/管理入口。

目标：

- **G1 桌面应用体验**：双击图标启动，独立窗口（标题 IF.Cope），托盘常驻，关窗最小化到托盘；
- **G2 数据目录自选**：首次启动选择数据文件夹（如 `D:\IfCope数据`），此后数据库/上传文件/翻译产物/AI 模型全在里面，整体可拷贝/备份/迁移；设置里可随时更改（带迁移）；
- **G3 文件集中管理**：应用内「我的文件」页集中列出全部用户文件，支持资源管理器打开（定位到用户文件夹）、导入、导出、删除、存储统计；
- **G4 网页模式不回归**：本机浏览器照常访问 localhost:3777，与桌面窗口共享同一服务与数据（不做多设备/认证，本期范围外）。

## 2. 总体架构

**核心原则：服务层不动，壳层包服务，路径层抽配置。** 现有 Next.js 服务（含 3778 反代、SQLite、ONNX 本地推理）作为独立 Node 子进程运行；Electron 只做壳（窗口/托盘/生命周期）；数据路径从配置读。

```
┌─ Electron 壳（main 进程）───────────────────────────────┐
│  窗口管理 / 托盘 / 单实例锁 / 开机自启(可选)               │
│  首启向导：选数据目录 → 写 %APPDATA%/ifcope/config.json   │
│  spawn 子进程: node server.js（打包内嵌 Node 运行时）      │
└──────────────┬─────────────────────────────────────────┘
               ▼ http://localhost:3777（仅监听 127.0.0.1）
┌─ 现有 Next.js 服务（几乎不动）───────────────────────────┐
│  /classroom /translate /solve /tools /chat  + API 路由   │
│  3778 反代（随服务启动，原样保留）                         │
│  better-sqlite3 / ONNX / Python 侧车（原样，路径改读配置） │
└──────────────┬─────────────────────────────────────────┘
               ▼
┌─ 用户数据目录（自选，如 D:\IfCope数据）──────────────────┐
│  ifcope.db  uploads/  translations/  models/  backups/   │
└─────────────────────────────────────────────────────────┘
```

- 壳与服务解耦：服务仍是标准 Node 进程，`npm run dev` 网页模式完全不受影响；
- **原生模块零适配**：better-sqlite3、onnxruntime-node、fastembed 全在 Node 子进程里跑，不进 Electron 主进程，无需 electron-rebuild；
- 浏览器/桌面窗口访问同一 URL，数据天然一致（G4 免费达成）。

### 2.1 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 壳 | Electron 33+ | 用户已选；原生模块零适配（子进程模式）；Windows 打包成熟 |
| 打包 | electron-builder → NSIS 安装包 | 标准路线；桌面快捷方式 + 卸载器 |
| 服务运行时 | 打包时内嵌精简 Node（或 `nodejs-portable` 约 30MB） | 用户机器不必装 Node；Next standalone 输出配合 |
| Next 构建 | `output: "standalone"` | 服务端产物自包含，`node server.js` 直接跑 |
| 配置存储 | `%APPDATA%/ifcope/config.json`（壳与服务共用） | 存 `dataDir`、`port`、`windowBounds`、`trayOnClose` |
| Python 侧车（PDF 翻译） | 打包进 `resources/`，路径从配置解析 | 现有 `pdfTranslate.ts` 找 `bin` 的逻辑改根目录即可 |

## 3. 数据目录抽象（G2）

### 3.1 目录布局（用户数据目录）

```
<数据目录>/
├── ifcope.db / ifcope.db-wal / ifcope.db-shm
├── uploads/          # 原始文件（uuid.{ext}）
├── translations/     # PDF 翻译产物
├── models/           # whisper ONNX、bge 向量模型
└── backups/          # 现有备份逻辑
```

### 3.2 配置解析链（`src/lib/paths.ts`，单点模块）

优先级：**环境变量 `IFCOPE_DATA_DIR` > `%APPDATA%/ifcope/config.json` 的 `dataDir` > 回退 `process.cwd()/data`**（回退保证 `npm run dev` 旧习惯不破坏）。

改造点（现状 7 处硬编码，全部改调 `paths.ts`）：

| 文件 | 现状 | 改后 |
|---|---|---|
| `db.ts` | `cwd/data/ifcope.db` | `paths.dataDir()/ifcope.db` |
| `storage.ts` | `cwd/data/uploads` | `paths.uploadsDir()` |
| `pdfTranslate.ts` ×2 | `cwd/data/translations`、`cwd/data/uploads` | `paths.translationsDir()`、`paths.uploadsDir()` |
| `localEmbed.ts` | `cwd/data/models` | `paths.modelsDir()` |
| `parse/audio.ts` ×2 | `cwd/data/models` | `paths.modelsDir()` |

`paths.ts` 职责：解析配置 → 懒创建目录 → 导出 `dataDir/uploadsDir/translationsDir/modelsDir/backupsDir/configPath`。**约束：数据库连接与模型缓存目录必须在模块初始化时定死**（better-sqlite3/ONNX 不支持运行中换目录），所以「更改数据目录」= 迁移 + 重启服务（见 §3.4）。

### 3.3 首启向导（壳层）

1. 壳启动 → 读 config.json；无 `dataDir` → 弹原生目录选择框（默认建议 `文档\IFCope`）；
2. 写 config.json → spawn 服务；
3. 检测旧数据：若 `程序目录/data/` 存在且非空 → 弹询问「迁移旧数据到新目录 / 继续使用旧位置」；选迁移则**先停服 → 整目录 move → 再起服**（move 失败回滚复制+校验）。

### 3.4 更改数据目录（设置页）

设置页新增「数据目录」区：显示当前路径、占用大小、「更改…」按钮。流程同 §3.3-3：停服 → 迁移 → 改 config → 重启服务 → 壳窗口 reload。迁移中显示进度（目录可能数 GB）。

## 4. 文件集中管理（G3）

### 4.1 新页面 `/files`（或并入 /tools，实施计划定）

- **列表**：union 查询 `sources`（uploads）+ 翻译产物目录扫描 + `backups`；列：文件名、类型、大小、来源功能（文献翻译/解题/工具）、创建时间、所在子目录；
- **操作**：
  - 「在资源管理器中打开」= `shell.showItemInFolder(绝对路径)`（经 IPC，由壳实现；网页模式降级为显示路径供复制）；
  - 导出/另存为（原生保存对话框，壳 IPC；网页模式走浏览器下载）；
  - 删除（软删记录 + 删文件，二次确认）；
  - 导入文件（拖拽/选择 → 进 uploads + 建 source 记录）；
- **存储统计**：各子目录占用（du 扫描），供用户决定是否清理；
- **数据安全**：所有路径操作防穿越（现有 `pdfTranslate.ts` 的规范化校验模式推广为 `paths.safeResolve()`）。

### 4.2 与「自选目录」的关系

文件本来就在用户文件夹里（G2 保证），`/files` 页是**应用内操作入口**（导出/整理/统计），用户用系统资源管理器直接看文件夹同样成立——两条路并存，不冲突。

## 5. Electron 壳规格（G1）

| 能力 | 行为 |
|---|---|
| 启动 | 单实例锁（二次启动聚焦已有窗口）；spawn 服务子进程，轮询 `localhost:3777` 就绪后 load URL；启动失败（端口占用等）弹原生错误框并给指引 |
| 窗口 | 无边框浏览器窗（保留系统标题栏）；记住窗口大小位置（config.json `windowBounds`）；最小化可到托盘 |
| 托盘 | 图标 + 菜单：显示主窗口 / 打开网页版 / 退出；**关闭窗口 = 最小化到托盘**（首次提示，可改设置为直接退出） |
| 退出 | 停服务子进程（SIGTERM + 超时强杀）→ 退出；托盘退出同 |
| 开机自启 | 设置项（`app.setLoginItemSettings`），默认关 |
| 网页版入口 | 托盘/设置页「浏览器打开 localhost:3777」按钮（G4） |
| 端口 | 默认 3777，被占自动递增并写回 config（服务侧读 config 端口；浏览器模式仍固定 3777 习惯不变——冲突时提示） |
| 版本/更新 | 本期不做自动更新；设置页显示版本号 |

安全约束：`contextIsolation: true`、`nodeIntegration: false`、preload 白名单 IPC（仅 `selectDir`/`showItemInFolder`/`saveAs`/`getPaths`/`quit` 等少量通道）；窗口仅 load 本机服务 URL。

## 6. 不做的事（本期范围外）

- 多设备/局域网访问与认证（G4 明确不做；架构不阻塞后续加）；
- 自动更新、代码签名、应用商店分发；
- 云同步/网盘协同（数据放网盘同步目录属用户自行选择，不承诺并发安全）；
- 移动端；
- 现有功能（课堂/翻译/解题/工具/对话）行为变更——除路径来源外零改动。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 打包体积大（Node 运行时 + ONNX 模型 + Python 侧车，估 300MB+） | 模型不进安装包（首用下载到数据目录，与现状一致）；Python 侧车可选组件一期先整包 |
| `next dev` 与 Electron 并存混淆 | 网页模式=不启动壳直接 dev/start，行为完全不变；文档写清两模式 |
| 数据目录在网络盘/同步盘时 SQLite 并发风险 | 设置页标注警告「网络盘可能损坏数据库」；WAL 模式保留 |
| 迁移中途失败（断电/拔盘） | 迁移=copy→校验→切配置→删源；失败保留源数据并回滚 |
| 端口 3777/3778 被占（用户实测遇过 EADDRINUSE） | 壳启动时检测 + 强杀残留或自动递增，弹窗告知 |
| Windows Defender 对未签名安装包告警 | 一期接受并文档说明；代码签名留待分发需求明确后 |

## 8. 验收标准

1. 双击桌面图标 → 向导选目录 → 主窗口打开，全程无终端；
2. 数据目录里可见 `ifcope.db uploads/ translations/ models/ backups/`，全功能（课堂/翻译/解题）在新数据目录下正常；
3. 把数据目录整个拷到另一台装了本应用的机器、配置指向它，数据完整可用；
4. 设置页更改数据目录 → 迁移成功 → 数据完整；
5. 「我的文件」页能看到全部文件，「资源管理器中打开」正确定位；导出/删除/导入/统计可用；
6. 关窗到托盘，托盘退出干净停服；重复启动只开一个实例；
7. 不装壳 `npm run dev` 网页模式一切照旧（回归零）。
