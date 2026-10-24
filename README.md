# IF.Cope

校园 AI 学习工作站（本地 Demo，Next.js 15）。完整架构、数据模型、踩坑记录见
**`docs/IF.Cope-交接文档-20261023.md`**（权威交接文档，新会话从这里接手）。

## 功能总览

| 模块 | 说明 |
|---|---|
| **工作台** | 类目树 + 资源列表 + 双栏对话；右侧预览原生渲染 PDF/音频/视频/PPTX/图片/EPUB 与可编辑代码，便签系列（大纲/思维导图/流程图/测验/知识地图）画布渲染 |
| **快捷功能条** | 对话输入框上方：复习笔记 / 思维导图 / 流程图 / 大纲 / 测验 / 整理资源 / 解题答疑，选中资源一键生成对应产物 |
| **解题答疑（知识地图）** | `/solve`：AI 引导式提问 + React Flow 多地图工作区；卡片可拖动/调大小/追问小窗，引用抽屉预览原文，联网搜索（时效问题自动触发），导入导出 JSON/MD |
| **文献翻译** | `/translate`：仅 PDF，pdf2zh 保真双语翻译（保留原版排版），左原版右纯译文逐页对照，双 PDF 下载；翻译模型独立接口可在设置页配置 |
| **工具库** | 编解码 / 图片压缩 / 音频转文字(whisper) / PDF 处理 / 文本工具 / 二维码，均按需加载 |
| **设置 + 用量查询** | 对话与翻译模型分接口配置；供应商用量内置/New API/火山 AK-SK/通用模板四种探针 |

## 运行方式

```bash
npm install

# 开发（热更新，内存大，仅开发时用）
npm run dev            # http://localhost:3777

# 日常使用（推荐，省内存）
npm run build
npm run start          # http://localhost:3777
```

**内存实测（2026-10-23）**：dev 服务器 RSS ≈ **3.0 GB**；prod 服务器 RSS ≈ **198 MB**。
日常挂机请跑 `build + start`；**build 前必须停 dev**（两者同开会写坏 `.next`）。

### 文献翻译的外部依赖（pdf2zh）

PDF 保真翻译依赖 **PDFMathTranslate（pdf2zh）** CLI（uv 工具环境，独立 Python 3.12，
不污染主环境）；未安装时该功能自动降级提示，其余功能不受影响。安装/升级/故障排查见交接文档 §6。

## 内存策略（改动重模块时请遵守）

| 模块 | 策略 |
|---|---|
| whisper（STT） | **用完即释放**：`parse/audio.ts` 的 `withAsr` 转写完立即 dispose |
| fastembed（本地嵌入） | 常驻单例（检索热路径），模型在 `data/models/`，勿删 |
| pdfjs / mammoth / jszip / @audio/decode | **懒加载**（`await import`），解析到对应格式才载入 |
| 工具库 / 导图编辑器 | `next/dynamic` 按需加载 |
| markmap / mermaid（仅便签旧系列渲染用） | `next/dynamic` 按需加载，编辑器已用 React 原生实现不引库 |
| onnxruntime | overrides 钉 1.30（避免嵌套多版本 ~208MB） |

原则：**偶发使用的重模块，用完释放；按需使用的，动态加载；只有热路径才允许常驻。**

## 数据目录

- `data/ifcope.db` — SQLite（资料/分块/向量/对话/产物/设置）
- `data/uploads/` — 上传的原始文件（音频旁路缓存转写文本，重传同文件免重转）
- `data/translations/` — pdf2zh 双语/译文 PDF 产物
- `data/models/` — 本地模型缓存（嵌入 91MB + whisper 149MB），**勿删**

以上均不入 git（含密钥与隐私数据）；`verify/cvs-cookie.txt`、`*.key`、`*.pem` 已 gitignore。
