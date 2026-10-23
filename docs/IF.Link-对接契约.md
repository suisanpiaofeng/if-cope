# IF.Cope × IF.Link 对接契约（本地 Demo 基线）

日期：2026-10-21

## 1. 模型出口唯一

业务代码不得直接拼接模型地址。聊天、摘要和嵌入统一经过：

- `src/lib/modelGateway.ts`：地址归一化、认证 Header、连接测试
- `src/lib/llm.ts`：聊天模型
- `src/lib/embed.ts`：嵌入模型与索引重建
- `src/lib/artifact.ts`：笔记生成

当前阶段允许填写任意 OpenAI 兼容上游。正式切到 IF.Link 后，Base URL 使用中转站地址，API Key 使用学生在中转站创建的 Key。

## 2. 地址兼容规则

设置页和接口均接受：

- `https://token.iflink.tech`
- `https://token.iflink.tech/v1`
- 误粘的 `.../v1/chat/completions`
- 误粘的 `.../v1/embeddings`

系统会归一化成统一 Base URL。根地址会自动补 `/v1`。

## 3. Key 与计费边界

一期采用「学生自带中转站 Key」：

1. 学生到中转站创建 Key；
2. 在 IF.Cope 设置页填写；
3. IF.Cope 服务端验证并代理模型请求；
4. 中转站根据 Key 类型扣钱包余额或套餐权益；
5. IF.Cope 只记录本地用途台账，不实现第二套钱包。

一期不修改 `new-api` fork，不创建内部开通 API。

## 4. 正式登录边界

本地 Demo 可以保持单用户。正式接入必须遵守 IF.Link 现有合同：

- IF.Cope 创建独立 Logto Traditional Web 应用；
- 创建独立 Accounts M2M 应用；
- 使用 Accounts UUID 作为业务用户主键；
- 使用独立 HttpOnly Cookie；
- 接入 back-channel logout；
- 不共用官网、Token 站或 Accounts 的 Secret；
- IF.Cope 使用独立 PostgreSQL database（建议 `learn`）。

参考实现：`iflink-website` 的会员登录和 `iflink-accounts` 的站点接入指南。

## 5. 嵌入模型是索引契约

嵌入模型和向量维度一旦用于资料入库，不能随意更换：

- 连接测试会发送一条极短文本确认 embedding 维度；
- 更换嵌入模型并保存时，系统会原地重建已有 chunk；
- 旧索引和新模型维度不一致时，检索会明确失败，不会静默返回错误结果；
- 正式环境建议同时记录 `embedding_model` 和 `embedding_dimension`。

## 6. 当前可测试流程

1. 启动项目：`npm run dev`
2. 打开 `http://localhost:3777/settings`
3. 填写 Base URL、API Key、聊天模型、嵌入模型；
4. 点击「测试连接」；
5. 点击「保存并启用」；
6. 回到工作台上传资料并提问。

未配置模型时继续使用 mock，不影响 UI 和引用链路演示。
