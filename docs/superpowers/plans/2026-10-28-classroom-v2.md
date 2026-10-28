# 课堂专区 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 IF.Cope 内嵌看 CVS 课程回放（反代 + 网页登录，零 Playwright），并生成「逐课笔记 + 期末复习手册」双层笔记，回流 RAG、可导出。

**Architecture:** 本机反代（3778，随应用启动）转发 cvs.seu.edu.cn + CAS 域：剥 X-Frame-Options、改写 Set-Cookie/重定向/响应体，使 iframe 可内嵌官方页、浏览器可完成官方登录（Cookie 托管在 localhost 域）。前端经反代调官方接口拿课时目录与 AI 字幕，提交自家 API 落 SQLite；笔记生成走 modelGateway 单出口（未配置降级 mock）；产出 Markdown 登记为 source 进现有 RAG。

**Tech Stack:** Next.js 15（App Router、instrumentation.ts）、Node http/https 反代、better-sqlite3、现有 modelGateway/ingest/embed 链路、Tailwind。

**Spec:** `docs/课堂专区-架构规格-v2-20261028.md`（规格为设计依据，执行者须同读）

## Global Constraints

- 零新 npm 依赖（不装 Playwright/测试框架；验证用 `npx tsc --noEmit` + `npm run build` + node 脚本 + 浏览器冒烟）。
- 反代只监听 localhost（`127.0.0.1`），只转发不落盘媒体与凭据。
- 所有课堂表带 `user_id`（默认 `'local'`，沿 db.ts 既有 DEFAULT_USER）。
- 官方域名/CAS 域/接口路径全部集中在 `src/lib/classroom/cvsApi.ts` 与 `revProxy.ts` 顶部常量区，真机联调只改常量。
- 模型调用只走 `modelGateway.ts`（`modelEndpoint` + `modelHeaders`）；未配置模型（`!isModelConfigured`）降级 mock，链路不断。
- 合规声明文本以规格 §7 为单一事实源，版本号 `DISCLAIMER_VERSION = "2026-10-28-v2"` 钉在组件里。
- Build 前必须停 dev 服务器（同写 `.next` 会坏）；起服务器实测后必须杀干净进程（`netstat -ano | grep 3777`）。
- 每任务完成 = `npx tsc --noEmit` 0 错 + `npm run build` 成功 + 该任务验证步骤通过 + commit。

## Review Focus（最可能咬人的五条）

1. **Set-Cookie 改写**：上游 Cookie 带 `Domain=.seu.edu.cn` / `Secure`，浏览器在 localhost(http) 下会直接拒收 → 登录态丢失。归属 Task 2：`rewriteSetCookie` 纯函数 node 断言（剥 Domain、剥 Secure、多条 Cookie 逐条处理）。
2. **CAS 跨域重定向断链**：Location 指向未映射域名时窗口跳出反代 → 登录失败且无提示。归属 Task 2：`rewriteLocation` 纯函数断言（已知域名映射回前缀；未知域名返回错误提示页而非透传）。
3. **无会话/校园网外的前端链路**：页面白屏或按钮死等。归属 Task 3/4：冒烟验证——反代不可达时登录按钮与课时拉取显示明确错误横幅，不 spinner 死等。
4. **LLM 返回空/超时**：笔记生成落空内容。归属 Task 5：API 直连验证——mock 空响应时 `note_status=failed` + 明确错误，可重试，不写空笔记。
5. **RAG 重生成幂等**：重生成笔记/手册若叠加旧 chunks，检索结果重复。归属 Task 6/7：验证——重生成后 chunks 不翻倍（旧 source 级联删除）。

---

### Task 1: 数据层（迁移 + 类型 + store）

**Files:**
- Modify: `src/lib/db.ts`（在课堂表区追加 4 张表，参照文件内既有 `classroom_*` 注释区位置；若回退后不存在则在 settings 表后新增区块）
- Create: `src/lib/classroom/types.ts`
- Create: `src/lib/classroom/store.ts`

**Interfaces:**
- Produces（后续全部任务依赖）:
  - `types.ts`: `type LessonNoteStatus = "none" | "done" | "failed"`；`ClassroomCourse { id, cvs_course_id, name, term, teacher, lesson_count, processed_count, created_at }`；`ClassroomLesson { id, course_id, cvs_lesson_id, title, seq, replay_url, vod_status, duration_sec, note_status, error_note, created_at }`；`LessonNote { id, lesson_id, content_md, model, source_id, created_at }`；`CourseDigest { id, course_id, content_md, model, source_id, created_at }`
  - `store.ts`: `upsertCourse(input: { cvsCourseId: string; name: string; term?: string; teacher?: string }): number`；`listCourses(): ClassroomCourse[]`（含 lesson_count/processed_count=note_status='done' 数）；`getCourse(id: number): ClassroomCourse | undefined`；`deleteCourse(id: number): void`；`upsertLesson(input: { courseId: number; cvsLessonId: string; title: string; seq: number; replayUrl?: string; vodStatus?: number | null; durationSec?: number | null }): number`；`listLessons(courseId: number): ClassroomLesson[]`；`getLesson(id: number): ClassroomLesson | undefined`；`setLessonNoteStatus(id: number, status: LessonNoteStatus, errorNote?: string): void`；`getLessonNote(lessonId: number): LessonNote | undefined`；`saveLessonNote(lessonId: number, contentMd: string, model: string, sourceId: number | null): number`；`getDigest(courseId: number): CourseDigest | undefined`；`saveDigest(courseId: number, contentMd: string, model: string, sourceId: number | null): number`

- [ ] **Step 1: db.ts 加 4 张表**

`classroom_courses`（id PK AUTOINCREMENT, user_id TEXT NOT NULL DEFAULT 'local', cvs_course_id TEXT NOT NULL, name TEXT NOT NULL, term TEXT NOT NULL DEFAULT '', teacher TEXT NOT NULL DEFAULT '', meta_json TEXT NOT NULL DEFAULT '{}', created_at/updated_at INTEGER NOT NULL, UNIQUE(user_id, cvs_course_id)）；`classroom_lessons`（id PK, course_id INTEGER NOT NULL REFERENCES classroom_courses(id) ON DELETE CASCADE, user_id DEFAULT 'local', cvs_lesson_id TEXT NOT NULL, title TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, replay_url TEXT NOT NULL DEFAULT '', vod_status INTEGER, duration_sec INTEGER, note_status TEXT NOT NULL DEFAULT 'none', error_note TEXT NOT NULL DEFAULT '', created_at/updated_at, UNIQUE(user_id, cvs_lesson_id)）；`classroom_notes`（id PK, lesson_id INTEGER NOT NULL REFERENCES classroom_lessons(id) ON DELETE CASCADE, user_id DEFAULT 'local', content_md TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', source_id INTEGER, created_at/updated_at, UNIQUE(lesson_id)）；`classroom_digests`（id PK, course_id INTEGER NOT NULL REFERENCES classroom_courses(id) ON DELETE CASCADE, user_id DEFAULT 'local', content_md TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', source_id INTEGER, created_at/updated_at, UNIQUE(course_id)）；加 `idx_classroom_lessons_course ON classroom_lessons(course_id, seq)`。

- [ ] **Step 2: 写 types.ts 与 store.ts**（按 Interfaces 块的签名；store 沿 `src/lib/classroom/store.ts` v1 风格——`db.prepare(...)` + DEFAULT_USER；upsert 幂等语义：同 cvs_id 更新名称/链接/排序，不重建）

- [ ] **Step 3: 验证表结构**

Run: `npm run build && node -e "const db=require('better-sqlite3')('data/ifcope.db',{readonly:true});const t=db.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'classroom%'\").all();console.log(t.map(r=>r.name).join(','))"`
Expected: 输出含 `classroom_courses,classroom_lessons,classroom_notes,classroom_digests`

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/lib/classroom/
git commit -m "feat(课堂专区): 数据层 —— 4 张课堂表 + types + store"
```

---

### Task 2: 反代服务器（3778）+ 启动挂载 + Cookie 手动兜底

**Files:**
- Create: `src/lib/classroom/revProxy.ts`
- Create: `src/instrumentation.ts`
- Modify: `src/app/api/classroom/proxy-info/route.ts`（Create：`GET` 返回 `{ running: boolean, port: number }`，读 revProxy 模块级 `isRunning()`）
- Create: `src/app/api/classroom/cookie/route.ts`（POST 保存手动 Cookie 到 settings 表 key `classroom.proxyCookie`；DELETE 清除；GET 返回 `{ has: boolean }` 不回显内容）

**Interfaces:**
- Consumes: db.ts 的 `db`（settings 表读写）
- Produces:
  - `revProxy.ts`: `startRevProxy(): void`（幂等：重复调用不双开端口；模块级 `isRunning(): boolean`；监听失败 `EADDRINUSE` 打日志不抛）；导出纯函数供验证：`rewriteSetCookie(setCookieValue: string): string`、`rewriteLocation(location: string): string | null`（null=未知域名，调用方回 502 提示页）
  - 常量区（顶部）：`PORT = 3778`、`CVS_HOST = "cvs.seu.edu.cn"`、`CAS_HOSTS: string[]`（初值 `["auth.seu.edu.cn", "ids.seu.edu.cn"]`，注释「真机联调确认」）、路径前缀 `"/__cas/"` → CAS_HOSTS[0]
  - 路由行为：`/__login` → 302 到 `/__cas/<CAS 登录路径>`（登录路径常量 `CAS_LOGIN_PATH`，初值 `"/cas/login"`，真机调）；`/__whoami` → 无 Location 的上游 2xx 视为已登录返回 `{ loggedIn: true }`，上游 Location 含 CAS 域返回 `{ loggedIn: false }`，上游不可达 502；`/api/classroom/proxy-info` 由 Next 自己处理不进反代；其余全部转发 CVS_HOST
  - 转发规则：剥头集 `{x-frame-options, content-security-policy, content-security-policy-report-only, strict-transport-security, x-xss-protection, x-download-options, x-permitted-cross-domain-policies}`；`set-cookie` 逐条 `rewriteSetCookie` 后透传（**不是剥掉**——登录态靠它落 localhost）；`accept-encoding` 删除（不压缩，便于改写）；伪造 `referer/origin` 为 `https://CVS_HOST`；请求头 `cookie` 优先用浏览器自带的（浏览器会自动带 localhost:3778 的 cookie），仅当浏览器无 cookie 且 settings 有手动 Cookie 时补上（**v1 教训：无 cookie 时 delete 头，禁止赋 undefined**）
  - 响应体改写：仅 `content-type` 含 `text/html` 或 `javascript` 时，把响应体中 `https://CVS_HOST` 与 `//CVS_HOST` 替换为 `http://localhost:3778`、CAS 域替换为 `http://localhost:3778/__cas`（流式：先 buffer 全文再改写输出；其他类型原样 pipe）
  - CORS：`access-control-allow-origin: http://localhost:3777` + `allow-credentials: true` + `allow-headers/methods`；`OPTIONS` 直接 204
  - 健壮性：整个 handler try/catch；上游 error → 502 纯文本「代理错误：…（确认本机在校园网/VPN 内）」；**绝不 throw 出 handler**（v1 uncaughtException 打挂主进程的教训）

- [ ] **Step 1: 写纯函数验证脚本**

两个改写纯函数放独立零依赖文件 `src/lib/classroom/cookieRewrite.ts`（无任何 import，便于独立验证）。验证脚本 `scripts/verify-revproxy-fn.mjs` 用 Node 原生 TS 支持加载：`node --experimental-strip-types scripts/verify-revproxy-fn.mjs`（执行前先 `node -v` 确认 ≥22.6；不支持则把 cookieRewrite.ts 临时复制为 .mjs 验证）。脚本断言：
  - `rewriteSetCookie("a=1; Domain=.seu.edu.cn; Path=/; Secure; HttpOnly")` === `"a=1; Path=/; HttpOnly"`（Domain 与 Secure 被剥，HttpOnly 保留，Path 不变）
  - `rewriteSetCookie("b=2; Path=/")` === `"b=2; Path=/"`（无 Domain/Secure 时原样）
  - `rewriteLocation("https://auth.seu.edu.cn/cas/login?x=1")` === `"http://localhost:3778/__cas/cas/login?x=1"`
  - `rewriteLocation("https://cvs.seu.edu.cn/home")` === `"http://localhost:3778/home"`
  - `rewriteLocation("https://evil.example.com/")` === `null`

- [ ] **Step 2: 跑验证脚本确认失败**

Run: `node scripts/verify-revproxy-fn.mjs`（配 `node --experimental-strip-types`）
Expected: 报错（模块不存在）

- [ ] **Step 3: 实现 `src/lib/classroom/cookieRewrite.ts` 与 `src/lib/classroom/revProxy.ts`**

按 Interfaces 块。revProxy 用 `http`/`https` 模块（参照 `verify/cvs-proxy.js` 原型的转发骨架，但 Set-Cookie 从「剥掉」改为「改写透传」，并加 CAS 前缀路由、body 改写、CORS、try/catch）。

- [ ] **Step 4: 跑验证脚本确认通过**

Run: `node --experimental-strip-types scripts/verify-revproxy-fn.mjs`
Expected: 全部断言 PASS，退出码 0

- [ ] **Step 5: instrumentation.ts + proxy-info + cookie API**

`src/instrumentation.ts`: `export async function register() { if (process.env.NEXT_RUNTIME === "nodejs") { const { startRevProxy } = await import("./lib/classroom/revProxy"); startRevProxy(); } }`。两个 API route 按 Produces 契约实现。

- [ ] **Step 6: 起服务器验证反代行为（无需校园网）**

Run: `npm run build && npm run start` 后：
- `curl -s http://localhost:3778/__login -o /dev/null -w "%{http_code} %{redirect_url}"` → 302 且 redirect 指向 `http://localhost:3778/__cas/...`
- `curl -s http://localhost:3777/api/classroom/proxy-info` → `{"running":true,"port":3778}`
- `curl -s -X POST http://localhost:3777/api/classroom/cookie -H "content-type: application/json" -d "{\"cookie\":\"a=1\"}" && curl -s http://localhost:3777/api/classroom/cookie` → 第二条 `{"has":true}`
- `curl -s http://localhost:3778/some-page`（校园网外）→ 502 且含「校园网」提示文案；**且 `curl -s http://localhost:3777/` 仍 200**（主进程存活）
- `netstat -ano | grep 3778` 确认监听 `127.0.0.1`（非 `::`全网卡）

- [ ] **Step 7: 杀服务器 + Commit**

```bash
# 杀 start 进程后再提交
git add src/lib/classroom/ src/instrumentation.ts src/app/api/classroom/ scripts/verify-revproxy-fn.mjs
git commit -m "feat(课堂专区): 本机反代 —— 剥XFO/Cookie改写/CAS前缀路由/随应用启动"
```

---

### Task 3: 课堂页骨架（入口 + 声明拦截 + 登录 + 课程登记）

**Files:**
- Create: `src/components/classroom/DisclaimerGate.tsx`
- Create: `src/app/classroom/page.tsx`
- Modify: `src/components/Sidebar.tsx:28-31`（NavItem 加 `label="课堂" href="/classroom"`；icon 联合类型加 `"classroom"` 并补图标分支）

**Interfaces:**
- Consumes: Task 1 store API；`GET /api/classroom/proxy-info`、`POST/GET/DELETE /api/classroom/cookie`（Task 2）
- Produces:
  - `DisclaimerGate.tsx`: `export function DisclaimerGate({ onAccept }: { onAccept: () => void })`——满屏遮罩，含规格 §7 全部声明条目 + 版本号常量 `DISCLAIMER_VERSION = "2026-10-28-v2"`；同意写 `localStorage.setItem("ifcope.classroom.agreed", DISCLAIMER_VERSION)`（**存版本号非 "1"**，将来声明更新可重新拦截）
  - page.tsx 状态机：`agreed` 未定→加载中；`false`→显示 DisclaimerGate；`true`→专区
  - 「登录 CVS」按钮：`window.open("http://localhost:3778/__login", "cvs-login", "width=520,height=720")`；旁边状态徽标每 5s 轮询 `fetch("http://localhost:3778/__whoami", { credentials: "include" })` 显示「已登录/未登录」；`proxy-info` 显示 running=false 时禁用按钮并提示「反代未启动」
  - 手动 Cookie 兜底：登录区折叠入口「登录遇到问题？粘贴 Cookie」→ 弹窗 textarea → POST cookie API
  - 「＋登记」弹窗：输入课程链接 + 可选名称/学期 → `parseTeclId(url): string | null`（放 `src/lib/classroom/cvsApi.ts`，只解析明文 `teclId` query 参数；加密分享链接返回 null 并提示「暂只支持明文 teclId 链接，可先在官方页打开课程复制地址栏链接」）→ POST `/api/classroom/courses`（Create route：body `{ url, name?, term? }`，服务端 parseTeclId 解析，缺 teclId 返回 400）→ 课程树显示（`GET /api/classroom/courses`）

- [ ] **Step 1: 实现 cvsApi.ts 常量与 parseTeclId**

Create: `src/lib/classroom/cvsApi.ts`——常量区 `CVS_ORIGIN = "https://cvs.seu.edu.cn"`、`API = { lessons: (teclId: string) => `${CVS_ORIGIN}/<占位路径>?teclId=${teclId}`, subtitles: (teclId: string, lessonId: string) => `${CVS_ORIGIN}/<占位路径>` }`（两处占位路径注释「真机联调：F12 看官方页真实请求改这里」）；`export function parseTeclId(url: string): string | null`

- [ ] **Step 2: 实现 DisclaimerGate + 页面骨架 + Sidebar 入口 + courses API**

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 错

- [ ] **Step 4: 浏览器冒烟（CDP 或手动）**

启动 `npm run start`，浏览器开 `http://localhost:3777/classroom`：
- 首次进入显示声明拦截，同意后刷新不再弹
- 侧栏出现「课堂」入口，其他页正常
- 未启动场景：杀 3778（反代随主进程，故用 dev 场景模拟）不测也行，但 `proxy-info` 返回 running:true 时登录按钮可点，点击弹出新窗口加载 `__login`（校园网外该窗口显示 502 提示文案）
- 登记课程：粘贴 `https://cvs.seu.edu.cn/xxx?teclId=TEST123&y=1` + 名称「测试课」→ 课程树出现「测试课」；粘贴无 teclId 链接 → 表单内明确报错
- 用 node 验证落库：`node -e "...SELECT name,cvs_course_id FROM classroom_courses"` → 1 行 `测试课,TEST123`

- [ ] **Step 5: 清理测试课程 + Commit**

```bash
node -e "const db=require('better-sqlite3')('data/ifcope.db');db.prepare('DELETE FROM classroom_courses').run()"
git add src/app/classroom/ src/components/classroom/ src/components/Sidebar.tsx src/lib/classroom/cvsApi.ts src/app/api/classroom/
git commit -m "feat(课堂专区): 页面骨架 —— 声明拦截/登录(网页+Cookie兜底)/课程登记"
```

---

### Task 4: 课时目录 + 内嵌播放

**Files:**
- Modify: `src/lib/classroom/cvsApi.ts`（补课时目录 fetch 封装）
- Modify: `src/app/classroom/page.tsx`（课时列表栏 + 右栏双标签）
- Create: `src/app/api/classroom/lessons/route.ts`（POST 保存目录 + GET 列表；GET 带 `?courseId=`）

**Interfaces:**
- Consumes: Task 1 store、Task 2 反代、Task 3 cvsApi 常量
- Produces:
  - `cvsApi.ts`: `export async function fetchLessons(teclId: string): Promise<{ ok: boolean; lessons?: { cvsLessonId: string; title: string; seq: number; replayUrl: string; vodStatus: number | null; durationSec: number | null }[]; error?: string }>`——**定义在 cvsApi.ts、只被客户端页面调用**（内部 `fetch("http://localhost:3778" + API.lessons(teclId), { credentials: "include" })`，不被服务端 route import）；官方接口 404/结构不符 → `{ ok: false, error: "课时接口未联调（占位路径），先用『手动添加课时』" }`
  - 页面新增「同步课时」按钮（课程行）：fetchLessons → POST lessons 落库 → 列表刷新；`vodStatus === -3` 显示「转码中」徽标
  - 「手动添加课时」兜底：小表单（标题 + 回放链接）→ 同一 POST lessons（`cvsLessonId` 用 `manual-${Date.now()}`）
  - 右栏双标签：「▶ 视频」（默认）/「✎ 笔记」（笔记视图 Task 5 填充，本任务先放空态占位）
  - 视频标签：`activeLesson.replay_url` 解析出 path（v1 页面同款正则：`/^https?:\/\/(?:(?:cvs\.)?seu\.edu\.cn)?([^?#]*)/`，拼 query）→ `<iframe src={`http://localhost:3778${path}`} />`；无链接显示手粘输入框兜底

- [ ] **Step 1: 实现 POST/GET lessons API + 页面课时栏与 iframe**

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build` → 0 错

- [ ] **Step 3: 冒烟（无校园网可测部分）**

`npm run start` 后浏览器：
- 选课程 → 手动添加课时（标题「冒烟课时」+ 链接 `https://cvs.seu.edu.cn/test-play`）→ 列表出现
- 点课时 → iframe src = `http://localhost:3778/test-play`（DevTools 确认）；无链接课时显示手粘框
- 「同步课时」点击 → 显示明确错误横幅（占位路径未联调），不死等
- node 验证落库：classroom_lessons 1 行

- [ ] **Step 4: 清理 + Commit**

```bash
node -e "const db=require('better-sqlite3')('data/ifcope.db');db.prepare('DELETE FROM classroom_lessons').run()"
git add src/app/classroom/page.tsx src/lib/classroom/ src/app/api/classroom/lessons/
git commit -m "feat(课堂专区): 课时目录(同步+手动兜底) + 反代内嵌播放"
```

---

### Task 5: 逐课笔记生成（字幕 → LLM → 落库）

**Files:**
- Create: `src/lib/classroom/notes.ts`
- Create: `src/app/api/classroom/lessons/[id]/note/route.ts`（POST 触发 + GET 读取）
- Modify: `src/app/classroom/page.tsx`（课时行「生成笔记」按钮 + 笔记标签填充 + 「同步字幕」入口）

**Interfaces:**
- Consumes: Task 1 store；`getSettings/isModelConfigured/recordUsage`（db.ts）；`modelEndpoint/modelHeaders`（modelGateway.ts）；`estimateTokens`（embed.ts）
- Produces:
  - `notes.ts`: `export async function generateLessonNote(lessonId: number, input: { segments?: { start: number; end: number; text: string }[]; manualText?: string }): Promise<{ ok: boolean; error?: string }>`——无输入且无手动文本 → error「先同步字幕或粘贴课堂文本」；组装转写文本（每段前缀 `[mm:ss] `，>40000 字符截断并注记）；LLM 调用（非流式 chat/completions，temperature 0.3；prompt 契约：输出 markdown，含 `## 本节要点`（条目带 `[mm:ss]` 时间锚）、`## 关键概念`、`## 公式与结论`、`## 疑难点` 四节，只用转写内容不编造）；`isModelConfigured` 为 false → mock（四节骨架 + 转写前 5 条要点，标「演示」）；空响应/非 ok → `{ ok: false, error }`（**不写库**）；成功 → `saveLessonNote` + `setLessonNoteStatus(id,"done")`，失败 → `setLessonNoteStatus(id,"failed", msg)`
  - 页面：课时行「生成笔记」按钮（busy 态）；流程 = 优先用已存字幕（checkpoint 存 lesson？——**不存**：字幕每次由前端经反代现拉，POST body 直接带 segments），无字幕时弹「粘贴课堂文本」输入框走 manualText；笔记标签用现有 `@/components/Markdown` 渲染 `content_md`

- [ ] **Step 1: 实现 notes.ts + note API**

Mock 与 LLM 两路都有明确分支；`recordUsage("note", model, promptTokens, completionTokens)` 记账（mock 记 `"mock-lesson"`）。

- [ ] **Step 2: API 直连验证（验证点 4：空响应不落库）**

`npm run start` 后：
- `curl -X POST http://localhost:3777/api/classroom/lessons/<id>/note -H "content-type: application/json" -d "{\"manualText\":\"今天我们讲了极限的定义……\"}"` → 未配置模型走 mock：`{"ok":true}`，node 查 classroom_notes 有 1 行且 content_md 含「本节要点」，note_status=done
- 再次 POST（重生成）→ 仍 1 行（UNIQUE(lesson_id) upsert），不翻倍
- 未配模型场景已覆盖 mock；LLM 空响应场景：临时把 settings 里 baseUrl 指向 `http://127.0.0.1:9/`（不可达）→ POST → `{"ok":false,"error":...}`，note_status=failed，classroom_notes 行数不变；**改回 settings**（DELETE 对应 key）

- [ ] **Step 3: 页面接线 + 冒烟**

浏览器：点「生成笔记」→ busy → 笔记标签出现内容（mock 四节齐全）；失败时课时行显示 failed 徽标 + 错误横幅。

- [ ] **Step 4: 清理 + Commit**

```bash
git add src/lib/classroom/notes.ts src/app/api/classroom/lessons/ src/app/classroom/page.tsx
git commit -m "feat(课堂专区): 逐课笔记 —— 字幕/手动文本 → LLM 四节结构 → 落库"
```

---

### Task 6: RAG 回流 + 笔记阅读打磨

**Files:**
- Create: `src/lib/classroom/rag.ts`
- Modify: `src/lib/classroom/notes.ts`（生成成功后调回流）
- Modify: `src/app/classroom/page.tsx`（笔记标签头部显示「已在资料库可检索」徽标 + 时间锚说明）

**Interfaces:**
- Consumes: `saveFile`（storage.ts）、`ingestSource`（ingest.ts）；db 直插 sources 表（列同 `src/app/api/sources/route.ts:123` 的 insert：title/filename/ext/mime/size/sha256/source_type/url/type/category_id/status/created_at）
- Produces:
  - `rag.ts`: `export async function registerNoteAsSource(input: { title: string; contentMd: string; oldSourceId?: number | null }): Promise<{ ok: boolean; sourceId?: number; error?: string }>`——若 `oldSourceId` 存在：`DELETE FROM sources WHERE id=?`（chunks/FTS 由 db.ts 触发器级联）；`saveFile(Buffer.from(contentMd), "md")` 拿 storageName；sha256 用 `crypto.createHash("sha256")`；插 sources（`type: "笔记"`, `source_type: "file"`, `mime: "text/markdown"`, `status: "processing"`）；`await ingestSource(id)`；返回 `{ ok: true, sourceId: id }`；ingest 失败（status=failed）也返回 ok=true + sourceId（笔记本体已生成，回流失败不连坐笔记，error 字段带「已生成但未入检索」）——**但 note API 要把 error 透传给 UI**
  - 标题契约：逐课笔记 `${course.name}·${lesson.title}（课堂笔记）`

- [ ] **Step 1: 实现 rag.ts + notes.ts 接线**

- [ ] **Step 2: 验证（验证点 5：重生成幂等）**

`npm run start` 后：
- 对同一课时 POST note 两次（mock 路径）
- node 断言：`SELECT COUNT(*) FROM sources WHERE title LIKE '%（课堂笔记）%'` === 1；该 source 的 `SELECT COUNT(*) FROM chunks WHERE source_id=?` > 0 且两次生成后 chunk 总数与一次生成后相同量级（旧 source 已删，无叠加）
- FTS 检索：`SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH '极限'`（用 manualText 里稳定的词）> 0

- [ ] **Step 3: 页面徽标 + tsc/build + Commit**

```bash
git add src/lib/classroom/rag.ts src/lib/classroom/notes.ts src/app/classroom/page.tsx
git commit -m "feat(课堂专区): 笔记回流 RAG —— 生成即入检索，重生成幂等替换"
```

---

### Task 7: 期末复习手册

**Files:**
- Create: `src/lib/classroom/digest.ts`
- Create: `src/app/api/classroom/courses/[id]/digest/route.ts`（POST 生成/重生成 + GET 读取）
- Modify: `src/app/classroom/page.tsx`（课程头「📖 期末复习手册」入口 → 右栏手册视图，复用双标签第三态或独立覆盖层；导出按钮 Task 8 接）

**Interfaces:**
- Consumes: Task 1 store、Task 6 `registerNoteAsSource`
- Produces:
  - `digest.ts`: `export async function generateDigest(courseId: number): Promise<{ ok: boolean; error?: string }>`——取该课程全部 `note_status='done'` 课时的逐课笔记（按 seq 排序）；0 份 → error「先为课时生成逐课笔记」；拼接（每份前缀 `【第${seq}讲 ${title}】`，总量 >60000 字符时取最近 30 份并注记）；LLM prompt 契约：输出 markdown——`# ${course.name} 期末复习手册`、`## 复习总览`（课程脉络 1 段）、`## 主题复习`（**按主题重组**：同一知识点跨讲次合并，每主题含要点+「出现于：第x、y讲」索引）、`## 考点分层`（`### 必考`/`### 常考`/`### 了解` 三级）、`## 考前速查`（公式/结论清单）；mock 降级同 Task 5 纪律（`recordUsage("digest", ...)`）；成功 → `saveDigest` + `registerNoteAsSource`（标题 `${course.name}·期末复习手册`，oldSourceId 用旧 digest.source_id）
  - 页面：课程头按钮（有 ≥1 份逐课笔记时可点）→ 手动视图渲染 content_md + 「重新生成」+ 「已入检索」徽标

- [ ] **Step 1: 实现 digest.ts + API**

- [ ] **Step 2: 验证**

造 2 份逐课笔记（对 Task 3/4 的测试课程建 2 课时各 POST note）→ `curl -X POST /api/classroom/courses/<id>/digest` → `{"ok":true}`；node 查 classroom_digests 1 行、content_md 含「期末复习手册」「必考」（mock 契约里含这些节）；再 POST 一次 → 仍 1 行、sources 里手册 source 仍 1 个；0 笔记课程 POST → `{"ok":false,"error":"先为课时生成逐课笔记"}`

- [ ] **Step 3: 页面接线冒烟 + Commit**

```bash
git add src/lib/classroom/digest.ts src/app/api/classroom/courses/ src/app/classroom/page.tsx
git commit -m "feat(课堂专区): 期末复习手册 —— 主题重组+考点分层+课次索引，可重生成"
```

---

### Task 8: 导出 + 收尾（声明钉版 + 交接文档）

**Files:**
- Modify: `src/app/classroom/page.tsx`（笔记/手册视图头部「导出 MD」按钮）
- Modify: `docs/IF.Cope-交接文档-20261023.md`（课堂专区章节：架构、真机联调清单、运维要点）

**Interfaces:**
- Produces: `saveMarkdown(filename: string, contentMd: string): void`（page 内部 helper：`Blob` + `a.download`，文件名 `${课程名}-${课时标题或期末复习手册}.md`）；下载确认弹层固定文案「课堂资料属学校教学资源，请勿公开转发」（规格 §7 导出出口要求）

- [ ] **Step 1: 导出按钮 + 合规提示弹层**

- [ ] **Step 2: 冒烟**

浏览器：笔记视图点导出 → 下载 `.md` 文件且内容为 content_md；先见合规提示确认。

- [ ] **Step 3: 交接文档同步**

真机联调清单（文档内一节，逐条列）：① CAS 域与登录路径（`revProxy.ts` CAS_HOSTS/CAS_LOGIN_PATH）② 课时/字幕接口路径（`cvsApi.ts` API 常量）③ 官方页资源 404 时的响应体改写规则补充（revProxy 常量区）④ 登录链路整体走通验证步骤。运维要点：3778 端口占用排查、Cookie 过期症状（iframe 显示登录页 → 点「登录 CVS」重登）。

- [ ] **Step 4: 全量验证 + Commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/classroom/page.tsx docs/
git commit -m "feat(课堂专区): 导出(带合规提示) + 交接文档真机联调清单"
```
