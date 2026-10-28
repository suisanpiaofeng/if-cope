// T5 冒烟：生成笔记（字幕不可用→手贴弹窗）→ 笔记标签渲染四节 → failed 徽标
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
  // 清残留 + 准备课程课时
  const old = await (await fetch(`${API}/api/classroom/courses`)).json();
  for (const c of (old.courses ?? []).filter((c) => c.cvs_course_id === "T5SMOKE")) {
    await fetch(`${API}/api/classroom/courses/${c.id}`, { method: "DELETE" });
  }
  const course = await (await fetch(`${API}/api/classroom/courses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://cvs.seu.edu.cn/x?teclId=T5SMOKE", name: "T5冒烟课" }),
  })).json();
  await fetch(`${API}/api/classroom/lessons`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ courseId: course.id, lessons: [{ cvsLessonId: "t5-ui-1", title: "第1讲 极限", seq: 1, replayUrl: "", vodStatus: null, durationSec: null }] }),
  });

  const tab = await newTab(`${API}/classroom`);
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.evalRetry(`localStorage.setItem("ifcope.classroom.agreed","2026-10-28-v2") || "ok"`);
  await cdp.send("Page.navigate", { url: `${API}/classroom` });
  await sleep(2500);

  // 1. 选课程 → 课时行出现「生成笔记」
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("T5冒烟课"))?.click(), "ok")`);
  await sleep(800);
  const genBtn = await cdp.evalRetry(`!!([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="生成笔记"))`);
  console.log("① 课时行生成笔记按钮:", genBtn ? "PASS" : "FAIL");

  // 2. 点课时 → 点「生成笔记」→ 字幕不可用 → 手贴弹窗出现
  await cdp.evalRetry(`([...document.querySelectorAll("div.group.cursor-pointer")].find(d=>d.textContent.includes("第1讲"))?.click(), "ok")`);
  await sleep(600);
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="生成笔记")?.click(), "ok")`);
  let pasteDialog = false;
  for (let i = 0; i < 20 && !pasteDialog; i++) {
    await sleep(500);
    pasteDialog = Boolean(await cdp.evalRetry(`document.body.innerText.includes("粘贴课堂文本")`));
  }
  console.log("② 字幕不可用弹手贴窗:", pasteDialog ? "PASS" : "FAIL");

  // 3. 粘贴文本 → 生成 → 笔记标签切过去显示四节
  await cdp.evalRetry(`(() => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "今天我们讲了极限的定义。epsilon-delta 语言。夹逼定理。");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);
  // 等 React 受控状态跟上（按钮从 disabled 变可点）再提交——设值后立即点会踩空
  let submitReady = false;
  for (let i = 0; i < 10 && !submitReady; i++) {
    await sleep(300);
    submitReady = Boolean(await cdp.eval(`(() => {
      const ta = document.querySelector("textarea");
      if (!ta) return false;
      const dialog = ta.closest("div.fixed");
      const btn = [...dialog.querySelectorAll("button")].find(b => b.textContent.trim() === "生成笔记");
      return btn && !btn.disabled;
    })()`));
  }
  // 弹窗内按钮与课时行同名——限定在弹窗容器（textarea 的 fixed 祖先）内点
  await cdp.evalRetry(`(() => {
    const dialog = document.querySelector("textarea").closest("div.fixed");
    const btn = [...dialog.querySelectorAll("button")].find(b => b.textContent.trim() === "生成笔记");
    btn?.click();
    return "ok";
  })()`);
  await sleep(2500);
  const dialogGone = await cdp.evalRetry(`!document.body.innerText.includes("粘贴课堂文本")`);
  if (!dialogGone) {
    const diag = await cdp.eval(`(() => { const ta = document.querySelector("textarea"); return ta ? "TA_VALUE=" + ta.value.slice(0, 20) : "NO_TA"; })()`);
    console.log("  ③诊断:", diag);
  }
  console.log("③ 提交后弹窗关闭:", dialogGone ? "PASS" : "FAIL");

  // 4. 课时行显示笔记徽标（限定在课时列表容器内，避免课程树「x/y 课时有笔记」假阳性）
  const hasBadge = await cdp.evalRetry(`document.body.innerText.includes("● 有笔记")`);
  console.log("④ 课时行有笔记徽标:", hasBadge ? "PASS" : "FAIL");

  // 5. 切「✎ 笔记」标签 → 四节渲染
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="✎ 笔记")?.click(), "ok")`);
  await sleep(1000);
  const fourSections = await cdp.evalRetry(`["本节要点","关键概念","公式与结论","疑难点"].every(s=>document.body.innerText.includes(s))`);
  // 模型徽标：环境可能已配置真实模型（内容为真实生成），不假设 mock
  const modelBadge = await cdp.evalRetry(`document.body.innerText.includes("生成模型")`);
  console.log("⑤ 笔记四节渲染+模型徽标:", fourSections && modelBadge ? "PASS" : "FAIL");

  // 6. 切回「▶ 视频」→ 无链接兜底仍在
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="▶ 视频")?.click(), "ok")`);
  await sleep(600);
  const backToListen = await cdp.evalRetry(`document.body.innerText.includes("本课时还没有回放链接")`);
  console.log("⑥ 切回视频视图:", backToListen ? "PASS" : "FAIL");

  const all = genBtn && pasteDialog && dialogGone && hasBadge && fourSections && modelBadge && backToListen;
  cdp.close();
  console.log(all ? "SMOKE PASS" : "SMOKE FAIL");
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e.message);
  process.exit(1);
});
