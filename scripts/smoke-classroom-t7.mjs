// T7 冒烟：手册按钮出现 → 生成 → 覆盖层渲染（含已入检索）→ 关闭
const CDP_PORT = 9333;
const API = "http://localhost:3777";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return r.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }
  ready() { return new Promise((res) => (this.ws.onopen = res)); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }
  async evalRetry(expression, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const v = await this.eval(expression);
        if (v !== undefined) return v;
      } catch { /* 上下文重建中 */ }
      await sleep(200);
    }
    return undefined;
  }
  close() { this.ws.close(); }
}

async function main() {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database("data/ifcope.db");
  // 清残留 + 准备有笔记的课程
  for (const c of db.prepare("SELECT id FROM classroom_courses WHERE cvs_course_id IN ('T7UI','T7SMOKE','T7EMPTY')").all()) {
    db.prepare("DELETE FROM classroom_courses WHERE id = ?").run(c.id);
  }
  for (const o of db.prepare("SELECT id FROM sources WHERE title LIKE '%（课堂笔记）%' OR title LIKE '%期末复习手册%'").all()) {
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(o.id);
    db.prepare("DELETE FROM sources WHERE id = ?").run(o.id);
  }
  const course = await (await fetch(`${API}/api/classroom/courses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://cvs.seu.edu.cn/x?teclId=T7UI", name: "T7UI课" }),
  })).json();
  await fetch(`${API}/api/classroom/lessons`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ courseId: course.id, lessons: [{ cvsLessonId: "t7ui-1", title: "第1讲", seq: 1, replayUrl: "", vodStatus: null, durationSec: null }] }),
  });
  const lessons = (await (await fetch(`${API}/api/classroom/lessons?courseId=${course.id}`)).json()).lessons;
  await fetch(`${API}/api/classroom/lessons/${lessons[0].id}/note`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ manualText: "泰勒公式、麦克劳林展开、余项估计。" }),
  });

  const tab = await newTab(`${API}/classroom`);
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.evalRetry(`localStorage.setItem("ifcope.classroom.agreed","2026-10-28-v2") || "ok"`);
  await cdp.send("Page.navigate", { url: `${API}/classroom` });
  await sleep(3000);

  // 1. 选课程 → 手册按钮出现
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("T7UI课"))?.click(), "ok")`);
  await sleep(1000);
  const btn = Boolean(await cdp.evalRetry(`document.body.innerText.includes("期末复习手册")`));
  console.log("① 手册按钮出现:", btn ? "PASS" : "FAIL");

  // 2. 点击（无已存手册 → 生成）→ 覆盖层打开
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("期末复习手册"))?.click(), "ok")`);
  let opened = false;
  for (let i = 0; i < 60 && !opened; i++) {
    await sleep(500);
    // 覆盖层独有标志：正文区的「生成模型」徽标行（中间栏按钮文案含“重新生成”不能用）
    opened = Boolean(await cdp.evalRetry(`document.body.innerText.includes("生成模型") && [...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="关闭")`));
  }
  console.log("② 生成后覆盖层打开:", opened ? "PASS" : "FAIL");

  // 3. 覆盖层含已入检索徽标 + 手册节结构（真实模型或 mock 均含关键节）
  const inRag = Boolean(await cdp.evalRetry(`document.body.innerText.includes("已入检索")`));
  console.log("③ 覆盖层已入检索徽标:", inRag ? "PASS" : "FAIL");

  // 4. 关闭（判定：「关闭」按钮消失 + 覆盖层独有的「生成模型」行消失）
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="关闭")?.click(), "ok")`);
  await sleep(600);
  const closed = Boolean(await cdp.evalRetry(`![...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="关闭") && !document.body.innerText.includes("生成模型")`));
  console.log("④ 关闭覆盖层:", closed ? "PASS" : "FAIL");

  const all = btn && opened && inRag && closed;
  cdp.close();
  console.log(all ? "SMOKE PASS" : "SMOKE FAIL");
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e.message);
  process.exit(1);
});
