# IF.Cope 课堂专区 · 原生 UI 改造设计（2026-11-09）

> 状态：**已与用户评审通过（对话评审 + 侦察确认），待实施计划（writing-plans）**。
> 本文修订 `课堂专区-架构规格-v2-20261028.md` 的 **D1 决策**：看课从「反代内嵌 iframe」改为「解析官方接口 + 原生 UI」。v2 的登录链（D4）、合规层（§7）、逐课笔记（M2/§4.1）继续有效；反代复用。
> 用户决策（2026-11-09）：**一期只做看课（最小可用）；课程/课时元数据落库 SQLite；彻底移除 iframe**。

## 1. 背景与目标

现状：`/classroom` 是整块 iframe（反代 3778 剥头后内嵌官方 SPA）。问题：官方 UI 交互受限（弹新窗被收敛、重载保位靠 postMessage 黑科技）、无法与原生功能融合。

目标：用 IF.Cope 原生 UI 实现「我的课程列表 → 课程搜索 → 课时列表 → 看回放」。视频流仍来自官方，本应用只做目录与播放壳。

## 2. 接口侦察结论（2026-11-09，静态资源逆向）

官方 SPA（`/jy-application-resourcemanage-ui/`）的静态资源**公网可直拉、无需登录**（index → webpack chunkmap → 85 个业务 chunk）。全部下载逆向，接口基址 `{API_BASE} = https://cvs.seu.edu.cn/jy-application-resourcemanage/v1`，前端经反代 3778 调用时即 `http://localhost:3778/v1/...`（Cookie 浏览器托管，反代 CORS 已放行 3777）。

| 用途 | 接口 | 说明 |
|---|---|---|
| 登录态探测 | `GET /__whoami`（反代自有） | 已有，沿用 |
| 全校课程搜索（「我的课程」页同款） | `GET /v1/teachingclass/list?pageIndex=&pageSize=20&type=4&allType=1&condition=<关键词>` | **2026-11-10 真机校准**：参数名用 `pageIndex`（不带 `page.` 前缀）；`type` 必填（缺则上游 500）；官方产品形态=搜索式（可搜到全校课，点选自己的班）；响应 `data.list[].{id(=teclId), subjId, subjCode, subjName(可null→teclName兑底), teclCode, teclName, teclImgUrl, acteName(可null), teacherList[].userName}`；**只取白名单字段落库**（响应含他人 studentList，合规红线）；勿拉全量（pageSize=100 时响应含全校名单，6s+/页） |
| 课时（回放）列表 | `GET /v1/subject_vod_list_new?page.pageIndex=1&page.pageSize=1000&teclIds=<teclId>&page.orders[0].asc=false&page.orders[0].field=courBeginTime&schoolOpenStatusFlag=false` | 响应 `data.records[]`，元素 `{id, courBeginTime, letiNumber, vodStatus(5=可播, -3=转码中)}`；teclIds 就是教学班 id（subjId/班号不适用）；2026-11-10 平台故障期 records 空（接口/参数本身正常） |
| 播放取流 | `GET /v1/course_vod_urls_new?courseId=<课时id>` | **2026-11-10 真机校准**：参数名是 `courseId`（不是 courId）；`course_vod_videoinfos` 是另一用途（传 courId 会 500）。返回 `data.courseVodViewList[]`，每路 `{viewNum, url}`；viewNum 5=课堂混音(aac)、3=录音(alaw)、1=无声录屏、2/4=学生机位、6=电子教鞭；URL 为直链（curl 可下载）。直链失败自动切 `3778/__h/` 兑底已实现；直链是否需 Referer/Cookie 待异常场景验证 |
| AI 字幕 | `GET /v1/course/ai/translate/{courseId}`、`POST /v1/course/ai/translate/detail` | **本期不做**，登记路径供 M2 逐课笔记用 |
| 播放统计 | `POST /v1/vod/keepAlive`、`/v1/vod/addVodWatchRecord`、`/v1/vod/recordPlayInfo` | **不做**。后果（接受）：官方平台的「观看记录/继续播放」不含我们 App 内的播放 |

搜索 = 官方同款搜索式交互（`condition` 参数）：搜全校课程 → 找到自己的班 → 点「+ 添加」落本地库。**不做全量同步**（响应含全校名单，且合规上不应缓存无关教学班）。

侦察工具：`scripts/recon/scan_api.js`（chunk 内 API 定义/调用上下文扫描），保留供 M2 复用。

## 3. 总体架构与数据流

沿 v2 §4 分工原则：**需要官方会话的请求由前端经反代发起**（Cookie 在浏览器侧，`credentials: "include"`），**拿到结果提交到 3777 落库**；LLM/纯本地操作走 3777。

```
┌─ 浏览器（localhost:3777 页面）────────────────────────────┐
│ /classroom 原生 UI                                         │
│  ├─ fetch 3778 /v1/teachingclass/list   → 拉我的课程（带 Cookie）│
│  ├─ fetch 3778 /v1/subject_vod_list_new → 拉课时目录          │
│  ├─ fetch 3778 /v1/course_vod_videoinfos→ 播放前取流（不落库）  │
│  ├─ <video src=官方直链>  或兜底 3778 /__h/<host>/…           │
│  └─ fetch 3777 /api/classroom/*         → 同步落库 / 本地读   │
├─ 3777 Next.js 服务端 ── SQLite（classroom_* 元数据）─────────┤
├─ 3778 反代（复用，随应用启动）──────────────────────────────┤
│  保留：/__login、/__cas、/__h、/__whoami、Set-Cookie 改写、   │
│        CORS、HTML/JS 绝对地址改写（登录窗口仍需正常渲染）      │
│  删除：iframe 导航收敛脚本注入（injectFrameNavScript）        │
└───────────────────────────────────────────────────────────┘
```

播放取流细节：
- `course_vod_videoinfos` 每次播放时**实时**拉（直链可能带时效签名，不缓存 URL）。
- `<video>` 默认直连官方媒体 URL（localhost 页面属 secure context，http 媒体可放）。
- 兜底：若真机出现 403/Referer/Cookie 校验，切换 src 为 `3778/__h/<媒体host>/<path>`（反代动态域路由已支持任意 `*.seu.edu.cn`）。

## 4. 数据模型（SQLite，沿 v2 §3 带 user_id）

```sql
classroom_courses(        -- 一门课 = CVS 一个教学班
  id PK, user_id, tecl_id, subj_id,
  subj_name, tecl_name, tecl_code, term,          -- acteName
  teac_names TEXT,                                 -- JSON 数组
  cover_url,
  meta_json, created_at, updated_at,
  UNIQUE(user_id, tecl_id)
)
classroom_lessons(        -- 一节课 = 一个回放
  id PK, course_id FK, user_id, cour_id,
  title, seq, begin_time, duration_sec,
  vod_status,                                      -- 官方转码状态（-3=转码中）
  created_at, updated_at,
  UNIQUE(course_id, cour_id)
)
```

- 对齐 v2 §3：`cvs_course_id→tecl_id`、`cvs_lesson_id→cour_id`、`replay_url` 不存（取流实时拉）、`note_status` 及笔记/手册表**本期不建**（M2 时按 v2 §3 补）。
- 同步策略：进页面本地为空或用户点「同步课程」→ 前端经反代拉 `teachingclass/list`（分页拉全）→ `POST /api/classroom/courses/sync` 幂等 upsert；进课程 → 拉 `subject_vod_list_new` → 同样落库。**只缓存本人有权访问的课程目录元数据，不存视频/字幕/凭据。**

## 5. 服务端 API（3777）

| 端点 | 说明 |
|---|---|
| `GET /api/classroom/courses?q=` | 本地课程列表（q 过滤 课程名/教学班/教师） |
| `POST /api/classroom/courses/sync` | upsert 落库（写库前校验关键字段，结构变了报错不写） |
| `GET /api/classroom/courses/[id]/lessons` | 本地课时列表 |
| `POST /api/classroom/courses/[id]/lessons/sync` | 课时 upsert 落库 |
| `DELETE /api/classroom/courses/[id]` | 删课程（级联课时） |

登录态：前端直连 `3778/__whoami` 轮询（沿用现有逻辑）；登录入口 `window.open("http://localhost:3778/__login")`（顶层窗口，零 Playwright，沿 v2 D4）。

## 6. 前端 `/classroom` UI（原生，三栏风格）

- **顶栏**：登录态徽章（whoami 轮询）·「登录 CVS」·「同步课程」· Cookie 兕底（保留）· msg/错误横幅位。
- **左栏**：课程卡片（封面/课程名/教学班/教师/学期），顶部搜索框本地过滤；空态 = 「先登录 CVS，再点同步课程」。
- **右主区**：
  - 课程态：课时表（标题/开课时间/时长/转码徽标，转码中灰态）；「刷新课时」按钮。
  - 播放态：原生 `<video>` + 机位切换（courseVodViewList，按 viewNum 命名）+ 返回课时列表。video 事件错误 → 提示可切机位/切代理兜底。
- **状态与错误**：反代未启动徽章（沿用 proxy-info）；fetch 3778 失败 → 显式横幅（含「需校园网/VPN」）；401/未登录 → 引导登录。
- **合规**：沿用 DisclaimerGate 拦截（声明文本与版本号沿 v2 §7 不变）。

## 7. 代码移除清单（彻底移除 iframe）

| 位置 | 处理 |
|---|---|
| `src/app/classroom/page.tsx` | 整体重写（删除 iframe、postMessage、navUrl/frameAuth/主页/重载按钮） |
| `src/lib/classroom/cookieRewrite.ts` 的 `injectFrameNavScript` | 删除导出与调用（其余改写保留） |
| `src/lib/classroom/revProxy.ts` 注入调用 | 删除 inject 调用，其余不动 |

## 8. 风险与未决

| 风险 | 缓解 |
|---|---|
| 接口为当期 SPA 快照，官方改版即失效 | 接口路径/字段名集中常量区（单点修）；同步写库前字段校验，失败显式报错；本设计下无 iframe 应急（用户已确认），应急 = 浏览器直开官方站 |
| `teachingclass/list` 响应字段名/分页结构待真机确认 | **已实机校准（2026-11-10）**：字段/参数见 §2 表；`type` 必填、`pageIndex` 命名、白名单落库（响应含他人 studentList）已实现 |
| 凭据过期表现为上游 500 而非 401 | 真机实测（2026-11-10）：反代域凭据过期时复杂查询 500、简单接口 200；UI 文案已引导「重新点登录 CVS 刷新凭据」 |
| 媒体直链是否需 Referer/Cookie | **待平台故障修复后验证（2026-11-10 遗留）**；兜底切 `3778/__h/` 转发（已有能力，非 `*.seu.edu.cn` 域被拦属预期） |
| 官方观看统计不回流 | 已接受（见 §2） |
| 校园网外不可用 | 全链路显式报错，无静默失败 |

## 9. 里程碑

- **N1 服务端**：建表 + courses/lessons sync 与查询 API（含字段校验）。✅ 2026-11-10
- **N2 前端**：原生 UI（搜索式添加/课时/播放态/登录态/声明拦截）。✅ 2026-11-10（实现中形态从「全量同步」改为「搜索+单门添加」，见 §2）
- **N3 移除 iframe + 反代瘦身 + 真机联调**：字段校准、媒体直连验证、tsc/build/CDP 冒烟、交接文档同步。✅ 2026-11-10（全链验收通过：登录→搜课→添加→课时 21 讲→播放；仅媒体直链异常场景未遇，见 §8）
