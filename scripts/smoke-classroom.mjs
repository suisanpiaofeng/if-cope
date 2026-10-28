// 课堂页 CDP 冒烟（T3）：声明拦截 → 同意 → 登记课程 → 课程树显示 → 落库校验
// 用法：先起 Edge（带 CDP 端口），node scripts/smoke-classroom.mjs
const CDP_PORT = 9333;

async function getTargets() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return r.json();
}

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
  /** 导航后上下文重建期间 evaluate 会失败——重试直到拿到值 */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tab = await newTab("http://localhost:3777/classroom");
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready();
  // 清同意标记 + 重载，确保验到「首次进入」拦截态（evalRetry 等导航后上下文重建）
  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await cdp.evalRetry(`localStorage.removeItem("ifcope.classroom.agreed") || "ok"`);
  await cdp.send("Page.navigate", { url: "http://localhost:3777/classroom" });
  await sleep(2000);

  // 1. 声明拦截：gate 必须在
  let gate = await cdp.evalRetry(`document.body.innerText.includes("使用前须知")`);
  console.log("① 首次进入显示声明拦截:", gate ? "PASS" : "FAIL");
  if (!gate) process.exit(1);

  // 2. 点同意
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("我已阅读并同意")).click()`);
  await sleep(800);
  const gateGone = await cdp.eval(`!document.body.innerText.includes("使用前须知")`);
  console.log("② 同意后拦截消失:", gateGone ? "PASS" : "FAIL");

  // 3. 侧栏「课堂」入口
  const nav = await cdp.eval(`!!document.querySelector('a[href="/classroom"]')`);
  console.log("③ 侧栏课堂入口:", nav ? "PASS" : "FAIL");

  // 4. 登记课程（含无 teclId 报错 + 正常落库）
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("＋ 登记")).click()`);
  await sleep(500);
  const setVal = (sel, v) => cdp.eval(`(() => {
    const el = document.querySelector("${sel}");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  // 4a. 无 teclId → 报错（选择器不带引号，避免模板嵌套语法错）
  await setVal('input[placeholder*=cvs]', "https://example.com/foo");
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="登记").click()`);
  await sleep(600);
  const badErr = await cdp.eval(`document.body.innerText.includes("没找到明文 teclId")`);
  console.log("④ 无teclId链接明确报错:", badErr ? "PASS" : "FAIL");
  // 4b. 正常登记
  await setVal('input[placeholder*=cvs]', "https://cvs.seu.edu.cn/test?teclId=SMOKE001&x=1");
  await setVal('input[placeholder*=高等数学]', "冒烟测试课");
  await cdp.eval(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="登记").click()`);
  await sleep(1000);
  const listed = await cdp.eval(`document.body.innerText.includes("冒烟测试课")`);
  console.log("⑤ 登记后课程树显示:", listed ? "PASS" : "FAIL");

  // 5. 登录按钮与 Cookie 兜底存在（登录态文案二选一：未登录「登录 CVS」/ 已登录「✓ 已登录」）
  const loginBtn = await cdp.eval(`document.body.innerText.includes("登录 CVS") || document.body.innerText.includes("已登录")`);
  const cookieBtn = await cdp.eval(`document.body.innerText.includes("Cookie 兜底")`);
  console.log("⑥ 登录按钮/Cookie兜底存在:", loginBtn && cookieBtn ? "PASS" : "FAIL");

  const all = gate && gateGone && nav && badErr && listed && loginBtn && cookieBtn;
  cdp.close();
  console.log(all ? "SMOKE PASS" : "SMOKE FAIL");
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e.message);
  process.exit(1);
});
