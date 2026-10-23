# IF.Cope

校园 AI 学习工作站（本地 Demo）。技术栈与架构见 `docs/项目总结与交接-20261022.md`。

## 运行方式

```bash
npm install

# 开发（热更新，内存大，仅开发时用）
npm run dev            # http://localhost:3777

# 日常使用（推荐，省内存）
npm run build
npm run start          # http://localhost:3777
```

**内存实测（2026-10-23）**：dev 服务器 RSS ≈ **3.0 GB**（编译缓存 + HMR，Next dev 的固有开销），
prod 服务器 RSS ≈ **196 MB**。日常挂机使用请跑 `build + start`；dev 仅在改代码时开，
且 **build 前必须停 dev**（两者同开会写坏 `.next`）。

## 内存策略（改动重模块时请遵守）

| 模块 | 策略 |
|---|---|
| whisper（STT） | **用完即释放**：`parse/audio.ts` 的 `withAsr` 转写完立即 dispose，不常驻 |
| fastembed（本地嵌入） | 常驻单例（检索热路径），模型在 `data/models/`，勿删 |
| pdfjs / mammoth / jszip / @audio/decode | **懒加载**（`await import`），解析到对应格式才载入 |
| 工具库各工具 | `next/dynamic` 按需加载，pdf-lib / qrcode 不进首屏包 |
| 便签渲染器（markmap / mermaid） | `next/dynamic` 按需加载 |

原则：**偶发使用的重模块，用完释放；按需使用的，动态加载；只有热路径才允许常驻。**

## 数据目录

- `data/ifcope.db` — SQLite（资料/分块/向量/对话/产物/设置）
- `data/uploads/` — 上传的原始文件
- `data/models/` — 本地模型缓存（嵌入 91MB + whisper 149MB），**勿删**，删后需 curl 重下

以上均不入 git（含密钥与隐私数据）。
