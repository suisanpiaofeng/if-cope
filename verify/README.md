# CVS 回放「内置显示框」可行性验证

> 2026-10-23 调研；**2026-11-04 清理：原型脚本（cvs-proxy.js / iframe-test.html / proxy-frame-test.html / stream-test.html）已删除**，下表为当时的实测结论存档（v2 的 revProxy.ts 即按此结论实现，正文见 git 历史）。

> 2026-10-23 · 目标：确定 IF.Cope 的课程学习专区能否**内嵌显示** `cvs.seu.edu.cn` 回放，以及数据抓取通道怎么选。
> 前置事实：平台在**校园内网**（`cvs.seu.edu.cn` → `10.64.86.180`，公网 DNS NXDOMAIN）。

## 已确认结论（服务端实测，2026-10-23）

| # | 证据 | 判定 |
|---|---|---|
| 1 | 首页 / 应用页响应头均有 **`X-Frame-Options: SAMEORIGIN`** | ❌ iframe 内嵌到 `localhost` 或线上域名 = 浏览器拒绝白屏，前端无解 |
| 2 | `Set-Cookie` 仅 `HttpOnly`，无 `SameSite`（浏览器默认按 Lax） | ❌ 即使能嵌，跨站 iframe 不带 Cookie，iframe 内登录也废（双重封死） |
| 3 | 无 `Access-Control-Allow-Origin` | ❌ 自家前端 JS 直接 fetch 其接口会被 CORS 拦 |
| 4 | 域名仅内网可解析 | ❌ 在线服务的**服务器大概率连不上** → 反代 / 流代理 / 服务端 Playwright 均不可靠 |

**结论：浏览器 iframe 路线出局。**「应用里看回放」改走以下路线：

| 路线 | 状态 | 说明 |
|---|---|---|
| **A. 弹窗并排**（`window.open` 官方播放页 + 应用内卡片位） | ✅ 一期采用 | 零风险；数据抓取走"令牌连接器"独立通道 |
| **B. `<video>` 直拉视频流**（自研内置播放器） | 🧪 待验证（`stream-test.html`） | 媒体元素不受 CORS 限制；流地址只能在**用户侧**抓（见 #4）；`viewNum=1` 是无音轨录屏，音频在 `viewNum=5`(aac)/`3`(pcm_alaw) |
| **C. 浏览器扩展** | 🧪 二期候选 | `declarativeNetRequest` 剥 X-Frame-Options 后可真内嵌；扩展同时兼任登录态/令牌连接器，一石三鸟 |
| **D. Electron 桌面壳 `<webview>`** | 🧪 远期候选 | 不受 XFO 限制，真内嵌；适合"学习伴侣"桌面版 |
| E. 服务端反代剥头 | ❌ 出局 | 服务器进不了内网 + 合规最差 |

## 怎么跑

需要**校园网/VPN**环境（否则打不开平台）。任选其一：

```powershell
cd iflearn-demo/verify
npx serve .        # 或 python -m http.server 8080
# 打开 http://localhost:3000/iframe-test.html  和  /stream-test.html
```

1. **iframe-test.html** —— 浏览器侧复核闸门①②（内嵌 / iframe 内登录），点按钮出 Markdown 结果。
2. **stream-test.html** —— 抓一个流地址粘进去（页面内有 3 步抓取说明），验证路线 B 能否成立。
3. 两个页面都有「复制结果（Markdown）」，贴回来即可定稿设计。

## 结果记录（跑完填这里）

| 页面 | 结果 | 日期 |
|---|---|---|
| iframe 浏览器侧复核 | | |
| 视频流：画面 | | |
| 视频流：音轨（viewNum=5/3） | | |
| 流地址是否过期/需鉴权头 | | |

## 对设计的影响

- 课程学习专区 = **「回放卡片位（A）+ 笔记工作台」**；观看走官方页，数据走用户侧令牌（粘贴 JWT 或浏览器扩展）。
- 路线 B 验证通过则升级为应用内播放器；C 只在"框内嵌体验"是硬需求时做。
- 无论哪条路线，**数据抓取与展示解耦**：显示框永远只是"看"，抓取永远是独立通道（同源策略铁律）。
