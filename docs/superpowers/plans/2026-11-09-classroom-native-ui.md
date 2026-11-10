# 课堂专区原生 UI 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 IF.Cope 原生 UI 实现「我的课程列表 → 搜索 → 课时列表 → 看回放」，替换现有 iframe 内嵌方案。

**Architecture:** 前端经既有反代（3778，带浏览器托管的 Cookie）调官方 CVS 接口拉目录/取流；3777 服务端只做元数据 SQLite 落库与本地查询；`<video>` 直连官方媒体直链，失败可切反代转发兜底。彻底移除 iframe 与导航收敛注入。

**Tech Stack:** Next.js 15 App Router（route handlers）、better-sqlite3、React 19、Tailwind 4、既有 revProxy（node:http）。

**Spec:** `docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md`（接口路径/字段侦察结论在 §2，数据模型 §4，API §5，UI §6，移除清单 §7）

## Global Constraints

- 只缓存本人有权访问的课程/课时**目录元数据**；不存视频、字幕、凭据（spec §4）。
- 需要官方会话的请求一律由**前端经 3778 反代**发起（`credentials: "include"`）；3777 服务端不直连 cvs.seu.edu.cn（spec §3）。
- 播放直链**每次播放实时拉取**，不落库、不缓存 URL（spec §3）。
- 官方接口路径与字段名集中在 `src/lib/classroom/types.ts` 常量区，单点修（spec §8）。
- 同步写库前必须校验关键字段；结构不符整体拒绝，不写半包（spec §8）。
- 反代维持既有纪律：只监听 127.0.0.1、handler 全 try/catch、错误降级 502 文案，禁止 throw 打挂主进程。
- 合规声明沿用 `DisclaimerGate`，`DISCLAIMER_VERSION` 与声明文本不变（v2 §7）。
- 不新增任何 npm 依赖。

## Review Focus

1. **官方响应结构变化**（条目缺 `teclId`/`subjName`，或列表不在预期包裹层）→ 同步整体拒绝并返回明确错误，库中无半包数据。→ Task 2 Step 3（curl 缺字段载荷断言 400 + 库空）。
2. **同步幂等**：同一载荷重复同步不产生重复行、不重建 id。→ Task 2 Step 2（连发两次断言 count=1 且 id 不变）。
3. **删课程级联**：删课程后课时必须为 0。→ Task 3 Step 2（建课→同步课时→删课→断言 lessons 空）。
4. **反代未启动/未登录/校园网外**：3778 fetch 失败 → UI 显式错误横幅（含「需校园网/VPN」提示），且本地已缓存课程仍可浏览。→ Task 5 Step 2（停反代冒烟）。
5. **播放取流失败/无可用机位**：直链 403 或 `courseVodViewList` 为空 → 直链失败先自动切 `3778/__h/` 代理兜底一次，仍失败则播放区显式错误与「重试/回列表」，不白屏不静默。→ Task 5 Step 1（行为定义）+ Step 2（伪造空机位响应冒烟）。

---

### Task 1: 数据层——旧空表迁移 + 类型常量区 + store

**Files:**
- Modify: `src/lib/db.ts`（顶部建表 exec 块内）
- Create: `src/lib/classroom/types.ts`
- Create: `src/lib/classroom/store.ts`

**Interfaces:**
- Consumes: `db`（`@/lib/db` 默认导出）。
- Produces（后续任务按此调用）:
  - `export const DEFAULT_USER = "local"`（重新加回 db.ts 并导出；v2 D6 沿用）
  - types.ts: `CVS_PROXY_BASE`、`CVS_VIEW_NAMES`、`ClassroomCourse`、`ClassroomLesson`、`CvsCourseItem`、`CvsLessonItem`、`CvsVodView`、`extractListItems(json: unknown): unknown[]`、`extractVodViews(json: unknown): CvsVodView[]`
  - store.ts: `upsertCourses(items: CvsCourseItem[]): { inserted: number; updated: number }`、`listCourses(q?: string): ClassroomCourse[]`、`getCourse(id: number): ClassroomCourse | undefined`、`deleteCourse(id: number): void`、`replaceLessons(courseId: number, items: CvsLessonItem[]): { inserted: number }`、`listLessons(courseId: number): ClassroomLesson[]`

- [ ] **Step 1: db.ts——DEFAULT_USER 导出 + 旧空表清理 + 新表 DDL**

在 `db.ts` 建表 exec 块内（原 classroom 注释处）追加：`export const DEFAULT_USER = "local"` 放模块顶层（不在 exec 里）；随后：

```ts
/* 课堂专区 v3（规格 docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md §4）
 * 旧 classroom_* 表（cvs_course_id 旧列）已在 2026-10-30 清空弃用；若仍存在且为空则删除重建。 */
for (const t of ["classroom_courses", "classroom_lessons", "classroom_notes", "classroom_digests"]) {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has) continue;
  const { c } = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number };
  if (c === 0) db.exec(`DROP TABLE ${t}`);
}
```

然后 CREATE 新两表（DDL 按规格 §4 全文：`classroom_courses` 含 user_id/tecl_id/subj_id/subj_name/tecl_name/tecl_code/term/teac_names(TEXT JSON)/cover_url/meta_json/时间戳，`UNIQUE(user_id, tecl_id)`；`classroom_lessons` 含 course_id(REFERENCES … ON DELETE CASCADE)/user_id/cour_id/title/seq/begin_time/vod_status/duration_sec，`UNIQUE(course_id, cour_id)`；索引 `idx_classroom_lessons_course ON classroom_lessons(course_id, seq)`）。

- [ ] **Step 2: types.ts——类型 + 常量 + 提取器**

按 Interfaces 块定义类型；常量：

```ts
export const CVS_PROXY_BASE = "http://localhost:3778";
export const CVS_VIEW_NAMES: Record<number, string> = { 1: "教师1", 2: "教师2", 3: "学生1", 4: "学生2", 5: "PPT", 6: "电子教鞭" };
```

`extractListItems`：输入官方 JSON，按序尝试 `data.records`、`data.list`、`data`（数组）、根数组，返回第一个数组；找不到返回 `[]`。`extractVodViews`：尝试 `data.courseVodViewList`、根 `courseVodViewList`，过滤出含非空 `url` 的 `{viewNum,url}`。

- [ ] **Step 3: store.ts——六个函数**

模式沿旧实现（`git show c282e88:src/lib/classroom/store.ts`）：每操作 `db.pragma("foreign_keys = ON")`；`upsertCourses` 校验每项必有 `teclId`、`subjName`（`String()` 归一），任一缺失 throw `Error("官方课程数据结构变化：缺少 teclId/subjName")`，事务内全部 upsert（UNIQUE 冲突走 UPDATE，返回 inserted/updated 计数）；`teac_names` 存 `JSON.stringify`；`listCourses(q)` 对 `subj_name/tecl_name/tecl_code/term` LIKE 过滤（q trim 后 `%q%`），带 `lesson_count` 子查询；`replaceLessons` 事务内「先 DELETE 该课程全部课时再批量 INSERT」（`title = \`${courBeginTime?.slice(0,10) ?? ""} 第${letiNumber ?? "?"}节\``，`seq` = 数组序号，`cour_id = String(id)`）；`listLessons` 按 `seq` 排序。

- [ ] **Step 4: 验证**

Run: `cd ifcope && npx tsc --noEmit && npm run build`
Expected: 均无错误退出。

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/classroom/types.ts src/lib/classroom/store.ts
git commit -m "feat(课堂): 数据层 v3——旧空表迁移+类型常量区+store（规格 N1）"
```

---

### Task 2: 课程 API——本地查询 / 同步落库 / 删除

**Files:**
- Create: `src/app/api/classroom/courses/route.ts`（GET）
- Create: `src/app/api/classroom/courses/sync/route.ts`（POST）
- Create: `src/app/api/classroom/courses/[id]/route.ts`（DELETE）

**Interfaces:**
- Consumes: Task 1 的 `upsertCourses / listCourses / getCourse / deleteCourse / extractListItems`。
- Produces（前端依赖的 JSON 形状）:
  - `GET /api/classroom/courses?q=` → `{ courses: ClassroomCourse[] }`
  - `POST /api/classroom/courses/sync` body `{ items: CvsCourseItem[] }` → 成功 `{ ok: true, inserted, updated }`；校验失败 `{ error: string }` 400
  - `DELETE /api/classroom/courses/[id]` → `{ ok: true }`；不存在 404

- [ ] **Step 1: 三个 route handler**

沿仓库模式：`NextRequest/NextResponse`、`export const runtime = "nodejs"`、`[id]` 用 `ctx: { params: Promise<{ id: string }> }`。sync handler：`items` 非数组或空 → 400「无可同步的课程数据」；`upsertCourses` throw → 400 透出 message；其余 200。

- [ ] **Step 2: 启动 dev 验证**

Run: `npm run dev` 后台起，然后：

```bash
P='{"items":[{"teclId":"101","subjName":"高等数学A","teclName":"高数A-01班","teclCode":"MATH101","acteName":"2025-2026-1","teacNames":["张三","李四"],"teclImgUrl":"http://x/1.jpg"}]}'
curl -s -X POST localhost:3777/api/classroom/courses/sync -H 'Content-Type: application/json' -d "$P"
curl -s -X POST localhost:3777/api/classroom/courses/sync -H 'Content-Type: application/json' -d "$P"   # 幂等
curl -s "localhost:3777/api/classroom/courses?q=高数"
```

Expected: 前两次都 `{ok:true,inserted:1,updated:0}` 再 `{ok:true,inserted:0,updated:1}`；列表 1 条且 `id` 两次间不变、`teac_names` 解析为数组、`lesson_count:0`。

- [ ] **Step 3: 结构变化防御**

Run: `curl -s -X POST .../sync -d '{"items":[{"subjName":"无teclId"}]}' -H 'Content-Type: application/json'`
Expected: 400，`error` 含「数据结构变化」；再 GET 列表确认仍只有原 1 条。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/classroom/courses
git commit -m "feat(课堂): 课程 API——本地查询/同步落库(结构校验+幂等)/删除"
```

---

### Task 3: 课时 API——本地查询 / 同步落库

**Files:**
- Create: `src/app/api/classroom/courses/[id]/lessons/route.ts`（GET）
- Create: `src/app/api/classroom/courses/[id]/lessons/sync/route.ts`（POST）

**Interfaces:**
- Consumes: Task 1 的 `replaceLessons / listLessons / extractListItems`；Task 2 的课程表。
- Produces:
  - `GET /api/classroom/courses/[id]/lessons` → `{ lessons: ClassroomLesson[] }`（课程不存在 404）
  - `POST .../lessons/sync` body `{ items: CvsLessonItem[] }` → `{ ok: true, inserted }`（整体替换语义）

- [ ] **Step 1: 两个 route handler**

sync：课程必须存在（404）；`items` 数组校验（缺 `id` 的条目 throw，整体拒绝）；空数组允许（= 清空该课课时）。

- [ ] **Step 2: dev 验证（含级联）**

```bash
curl -s -X POST localhost:3777/api/classroom/courses/1/lessons/sync -H 'Content-Type: application/json' \
  -d '{"items":[{"id":9001,"courBeginTime":"2026-11-02 10:00:00","letiNumber":3,"vodStatus":5},{"id":9002,"courBeginTime":"2026-11-05 10:00:00","letiNumber":4,"vodStatus":-3}]}'
curl -s localhost:3777/api/classroom/courses/1/lessons
curl -s -X DELETE localhost:3777/api/classroom/courses/1
node -e "const D=require('better-sqlite3');const db=new D('data/ifcope.db',{readonly:true});console.log(db.prepare('SELECT COUNT(*) c FROM classroom_lessons').get())"
```

Expected: sync `{ok:true,inserted:2}`；lessons 2 条且 title 形如 `2026-11-02 第3节`；删除后 `{c:0}`（级联）。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/classroom/courses/\[id\]/lessons
git commit -m "feat(课堂): 课时 API——整体替换同步/本地查询/级联验证"
```

---

### Task 4: 反代瘦身——移除 iframe 导航收敛注入

**Files:**
- Modify: `src/lib/classroom/cookieRewrite.ts`（删 `injectFrameNavScript` 及其脚本常量）
- Modify: `src/lib/classroom/revProxy.ts`（删 import 与 `rewriteBody` 中的调用；其余不动）

**Interfaces:**
- Consumes: 无。
- Produces: `rewriteBody` 签名不变（删去内部 inject 行后其余改写逻辑原样）。

- [ ] **Step 1: 删除注入**

删 `cookieRewrite.ts` 中 `injectFrameNavScript` 定义与相关脚本字符串、`revProxy.ts` 的 `injectFrameNavScript` import 与调用行。`grep -rn "injectFrameNavScript\|ifcope-frame\|ifcope-host" src/` 必须无结果（page.tsx 的旧 postMessage 逻辑在 Task 5 重写，此时若 grep 命中 app/classroom 不算违规，其余位置必须清零）。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run build`；然后 `npm run start`（或 dev）后 `curl -s localhost:3778/__canary`
Expected: 构建通过；canary 返回 200 文本（反代仍随应用启动）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/classroom/cookieRewrite.ts src/lib/classroom/revProxy.ts
git commit -m "refactor(课堂): 反代移除 iframe 导航收敛注入（原生 UI 不再需要）"
```

---

### Task 5: 前端原生页——列表/搜索/课时/播放

**Files:**
- Rewrite: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: Task 1 `CVS_PROXY_BASE/CVS_VIEW_NAMES/CvsVodView/extractVodViews`；Task 2/3 全部 API JSON 形状；既有 `Sidebar`、`DisclaimerGate`。
- Produces: 页面无 iframe、无 postMessage；顶栏文案「官方录播平台 · 原生浏览」。

- [ ] **Step 1: 页面重写**

组件结构（单文件，沿页面既有 Tailwind 风格）：
- 状态：`agreed`（DisclaimerGate 沿用）、`proxyRunning`（`/api/classroom/proxy-info`）、`loggedIn`（轮询 `${CVS_PROXY_BASE}/__whoami`，5s，逻辑沿现页）、`courses`、`q`、`activeCourse`、`lessons`、`playing`（`{ lesson: ClassroomLesson; views: CvsVodView[]; viewIdx: number; viaProxy: boolean } | null`）、`busy`、`error`。
- 顶栏：登录徽章 + 「登录 CVS」（`window.open(CVS_PROXY_BASE + "/__login")`）+「同步课程」+ Cookie 兜底（`CookieDialog` 原样保留）+ msg。
- 同步课程：`proxyFetch("/v1/teachingclass/list?page.pageIndex=" + i + "&page.pageSize=200")` 循环拉到不足一页（上限 10 页）→ `extractListItems` → `POST /api/classroom/courses/sync` → 刷新本地列表。任何一步失败 `setError`（含「需校园网/VPN」），**不清空已缓存列表**。
- 左栏：搜索框（本地 `q` 过滤 `listCourses` 结果）+ 课程卡片（封面 `cover_url`、`subj_name`、`tecl_name/tecl_code`、`teac_names.join("，")`、`term`）。
- 右主区：无 activeCourse → 课时表（`title/begin_time/vod_status`，`vodStatus!==5` 灰态「转码中/不可播」）；点可播课时 → `proxyFetch("/v1/course_vod_videoinfos?courId=" + cour_id)` → `extractVodViews` → 空数组显式错误；有则 `<video controls autoPlay className="w-full">`，src 计算：`viaProxy=false` 时为官方直链 `views[viewIdx].url`，`onError` 时置 `viaProxy=true` 自动重试一次 `CVS_PROXY_BASE + "/__h/" + new URL(直链).host + new URL(直链).pathname`（规格 §3 兜底）；代理兜底也 `onError` → 显式错误「播放失败，可切换机位或稍后重试」+「重试/回列表」。机位切换按钮（`CVS_VIEW_NAMES[viewNum] ?? "机位"+viewNum`）+「返回列表」。
- 「刷新课时」：对该课程同 courses 流程拉 `subject_vod_list_new`（query 参数常量照抄规格 §2：`teclIds/page.pageIndex=1/page.pageSize=1000/page.orders[0].asc=false/page.orders[0].field=courBeginTime/schoolOpenStatusFlag=false`）→ `POST lessons/sync`。
- 移除：iframe、`frameNav`、`navUrlRef/frameAuthRef`、重载/主页按钮、旧 `msg` 的 iframe 语义。

- [ ] **Step 2: 构建 + 冒烟（无真机）**

Run: `npx tsc --noEmit && npm run build`；dev 起后用 Task 2/3 的 curl 造 2 门课 + 课时，浏览器开 `localhost:3777/classroom`：声明拦截（清 localStorage 首次）→ 同意 → 列表渲染、搜索过滤、进课程看课时表、点转码中课时灰态。停 3778 反代（kill 进程）→ 点同步 → 出错横幅且列表仍在。

- [ ] **Step 3: Commit**

```bash
git add src/app/classroom/page.tsx
git commit -m "feat(课堂): 原生 UI——课程列表/搜索/课时/机位播放，移除 iframe"
```

---

### Task 6: 真机联调 + 收尾

**Files:**
- Modify: `docs/IF.Cope-交接文档-20261023.md`（课堂专区章节改为 v3 现状）
- Modify: `docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md`（§8 未决项回填实测结论）

- [ ] **Step 1: 真机（校园网/VPN）逐项校准**（用户配合）

登录 → 同步课程 → 核对 `teachingclass/list` 实际包裹层与字段名（不符改 types.ts 提取器/常量区一处）→ 进课程同步课时 → 播放：直链可放？需切 `3778/__h/` 兜底？`courseVodViewList` 实际路径？→ 回填两份文档。

- [ ] **Step 2: 全量验证**

Run: `npx tsc --noEmit && npm run build`；按 v2 §9 纪律 CDP 冒烟（声明拦截/登录入口/列表/播放）。

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(课堂): 原生 UI 真机联调结论回填 + 交接文档同步"
```
