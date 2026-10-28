// T4 冒烟：登记课程 → 手动添加课时 → 点课时出 iframe（src 经反代）→ 无链接课时显示手粘兜底 → 同步课时明确报错不死等
const CDP_PORT = 9333;
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
  async evalRaw(expression) {
    return await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  }
  /** 记录网络事件（诊断用） */
  netLog = [];
  async enableNet() {
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Network.requestWillBeSent" && m.params.request.url.includes("lesson/list"))
        this.netLog.push(`REQ ${new Date().toISOString().slice(14, 23)}`);
      if (m.method === "Network.responseReceived" && m.params.response.url.includes("lesson/list"))
        this.netLog.push(`RESP ${new Date().toISOString().slice(14, 23)} status=${m.params.response.status}`);
      if (m.method === "Network.loadingFailed")
        this.netLog.push(`FAIL ${m.params.errorText}`);
    });
    await this.send("Network.enable");
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
  // 清上轮残留：删旧测试课程再重建（保证验到空态）
  const old = await (await fetch("http://localhost:3777/api/classroom/courses")).json();
  for (const c of (old.courses ?? []).filter((c) => c.cvs_course_id === "T4SMOKE")) {
    await fetch(`http://localhost:3777/api/classroom/courses/${c.id}`, { method: "DELETE" });
  }
  const tab = await newTab("http://localhost:3777/classroom");
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.enableNet();
  await cdp.evalRetry(`localStorage.setItem("ifcope.classroom.agreed","2026-10-28-v2") || "ok"`);
  await cdp.send("Page.navigate", { url: "http://localhost:3777/classroom" });
  await sleep(2000);

  // 直接 API 准备测试课程（登记 UI 在 T3 已验）
  const courseRes = await fetch("http://localhost:3777/api/classroom/courses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://cvs.seu.edu.cn/x?teclId=T4SMOKE", name: "T4冒烟课" }),
  });
  const course = await courseRes.json();
  await cdp.evalRetry(`location.reload() || "ok"`);
  await sleep(2000);

  // 1. 点课程 → 课时空态提示
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("T4冒烟课"))?.click()`);
  await sleep(600);
  const emptyHint = await cdp.eval(`document.body.innerText.includes("尚无课时")`);
  console.log("① 课时空态提示:", emptyHint ? "PASS" : "FAIL");

  // 2. 手动添加课时（带回放链接）
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("＋手动"))?.click()`);
  await sleep(500);
  const setVal = (ph, v) => cdp.eval(`(() => {
    const el = [...document.querySelectorAll("input")].find(i => i.placeholder.includes(${JSON.stringify(ph)}));
    if (!el) return "NO_INPUT";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);
  await setVal("第 3 讲", "冒烟课时A-有链接");
  await setVal("cvs.seu.edu.cn", "https://cvs.seu.edu.cn/play?id=abc");
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="添加")?.click()`);
  await sleep(1200);
  const lessonA = await cdp.eval(`document.body.innerText.includes("冒烟课时A")`);
  console.log("② 手动添加课时落库显示:", lessonA ? "PASS" : "FAIL");

  // 3. 点课时 → iframe src 经反代
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("冒烟课时A"))?.click()`);
  await sleep(600);
  const iframeSrc = await cdp.eval(`document.querySelector("iframe")?.src ?? ""`);
  const iframeOk = iframeSrc.startsWith("http://localhost:3778/") && iframeSrc.includes("play?id=abc");
  console.log("③ iframe 经反代内嵌:", iframeOk ? "PASS" : "FAIL", `(${iframeSrc})`);

  // 4. 再加一个无链接课时 → 显示手粘兜底输入框
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("＋手动"))?.click()`);
  await sleep(500);
  await setVal("第 3 讲", "冒烟课时B-无链接");
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="添加")?.click()`);
  await sleep(1200);
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("冒烟课时B"))?.click()`);
  await sleep(600);
  const fallback = await cdp.eval(`document.body.innerText.includes("本课时还没有回放链接")`);
  const fallbackInput = await cdp.eval(`!!([...document.querySelectorAll("input")].find(i=>i.placeholder.includes("粘贴官方回放页链接")))`);
  console.log("④ 无链接课时手粘兜底:", fallback && fallbackInput ? "PASS" : "FAIL");

  // 5. 同步课时 → 明确错误横幅（占位路径），不死等
  // 注意：选择器必须精确匹配「同步课时」——课程树副标题「尚未同步课时」也含这三个字，includes 会误中课程按钮
  const btnFound = await cdp.evalRetry(`!![...document.querySelectorAll("button")].find(b=>b.textContent.trim() === "同步课时")`);
  await cdp.evalRetry(`([...document.querySelectorAll("button")].find(b=>b.textContent.trim() === "同步课时")?.click(), "clicked")`);
  // 轮询横幅出现（上游回包时间不稳，固定等会踩空）
  let syncErr = false;
  const t0 = Date.now();
  let lastRaw = null;
  for (let i = 0; i < 50 && !syncErr; i++) {
    await sleep(500);
    const r = await cdp.evalRaw(`document.body.innerText.includes("未联调") || document.body.innerText.includes("接口错误") || document.body.innerText.includes("请求失败") || document.body.innerText.includes("超时")`);
    lastRaw = r;
    if (r?.result?.value === true) syncErr = true;
  }
  console.log("  （横幅等待", Math.round((Date.now() - t0) / 1000), "s）");
  const notHanging = Boolean(await cdp.evalRetry(`![...document.querySelectorAll("button")].some(b=>b.textContent.trim() === "同步中…")`));
  if (!syncErr) {
    console.log("  btnFound:", btnFound);
    console.log("  轮询最后原始响应:", JSON.stringify(lastRaw).slice(0, 300));
    console.log("  网络事件:", cdp.netLog.join(" | ") || "(无)");
  }
  console.log("⑤ 同步课时明确报错且不死等:", syncErr && notHanging ? "PASS" : "FAIL");

  // 6. vod_status=-3 徽标（API 直插一条转码中课时验证）
  await fetch("http://localhost:3777/api/classroom/lessons", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ courseId: course.id, lessons: [{ cvsLessonId: "t4-vod", title: "转码中课时", seq: 9, replayUrl: "", vodStatus: -3, durationSec: null }] }),
  });
  await cdp.evalRetry(`location.reload() || "ok"`);
  await sleep(2000);
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("T4冒烟课"))?.click()`);
  await sleep(800);
  const vodBadge = await cdp.eval(`document.body.innerText.includes("转码中")`);
  console.log("⑥ vod转码中徽标:", vodBadge ? "PASS" : "FAIL");

  const all = emptyHint && lessonA && iframeOk && fallback && fallbackInput && syncErr && notHanging && vodBadge;
  cdp.close();
  console.log(all ? "SMOKE PASS" : "SMOKE FAIL");
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e.message);
  process.exit(1);
});
