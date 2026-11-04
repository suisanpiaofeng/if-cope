// 真机登录自测：你在弹出的 Edge 里手动登录，脚本监听整条链路，
// 验证「登录 → 回跳 → 会话建立 → 课程数据可内嵌」是否闭环，精确报出断点。
import { chromium } from "playwright";

const PROXY = "http://localhost:3778";
const CVS_HOME = `${PROXY}/jy-application-resourcemanage-ui/`;

const browser = await chromium.launch({
  headless: false, // 有头：你能看到并手动登录
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--start-maximized"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
const page = await ctx.newPage();

const log = [];
const mark = (s) => { console.log(s); log.push(s); };

// 监听：跳出反代的官方域请求（内嵌断链的信号）
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("cvs.seu.edu.cn") || (u.includes("seu.edu.cn") && !u.includes("localhost"))) {
    mark(`  ⚠️ 绕过反代: ${r.method()} ${u.slice(0, 100)}`);
  }
});
// 监听：关键里程碑
page.on("response", (r) => {
  const u = r.url();
  const loc = r.headers()["location"] || "";
  if (u.includes("oauth2/callback")) mark(`  ◆ OAuth callback: ${r.status()} ${u.replace(PROXY, "").slice(0, 60)}`);
  if (u.includes("return_uri") || u.includes("returnUri")) mark(`  ◆ 含 return_uri: ${r.status()}`);
  if (r.status() === 302 && loc.includes("localhost")) mark(`  ◆ 302→回反代: ${loc.slice(0, 80)}`);
});

mark("=== 加载 CVS（应跳登录页）===");
await page.goto(CVS_HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => mark("goto: " + e.message.split("\n")[0]));

// 等你登录（最多 4 分钟）
mark("\n=== 请在弹出窗口完成登录（一卡通号+密码+验证码）===");
mark("    登录成功后脚本自动继续，最多等 4 分钟…\n");
let loggedIn = false;
const deadline = Date.now() + 240000;
while (Date.now() < deadline && !loggedIn) {
  await page.waitForTimeout(2000);
  const u = page.url();
  const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  // 登录成功信号：离开认证中心域 / 出现课程相关 UI / return_uri 生效回跳
  if (!u.includes("__cas") && (u.includes("localhost") || u.includes("cvs"))) { loggedIn = true; break; }
  if (/课程|我的|教学|工作台|退出|个人/.test(body) && !u.includes("__cas/dist/#")) { loggedIn = true; break; }
}

mark("\n=== 登录后状态 ===");
mark(`URL: ${page.url().replace(PROXY, "[PROXY]").slice(0, 120)}`);
const text = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "").catch(() => "");
mark(`页面文本: ${text.replace(/\n/g, " | ")}`);

// 关键判定：会话是否真建立（打一个需登录的 API）
mark("\n=== 会话验证（课程列表 API）===");
const api = await page.evaluate(async () => {
  try {
    const r = await fetch("/jy-application-resourcemanage/v1/app/info", { credentials: "include" });
    return `HTTP ${r.status} ${((await r.text()) || "").slice(0, 120)}`;
  } catch (e) { return "ERR " + e.message; }
}).catch((e) => "eval ERR " + e.message);
mark(`  /v1/app/info → ${api}`);

// Cookie 是否落在 localhost
const cookies = await ctx.cookies("http://localhost:3778").catch(() => []);
mark(`\n=== localhost:3778 Cookie（${cookies.length} 条）===`);
cookies.slice(0, 8).forEach((c) => mark(`  ${c.name} (domain=${c.domain}, secure=${c.secure})`));

mark("\n=== 结论 ===");
mark(loggedIn ? "✅ 已登录并回跳——请看课程数据是否在页面里出现" : "❌ 4 分钟内未检测到登录成功");

// 最后：把当前页面截屏存证
await page.screenshot({ path: "scripts/probe-result.png", fullPage: false }).catch(() => {});
mark("截图已存 scripts/probe-result.png");

if (process.argv[2] === "--close") await browser.close();
else { mark("\n（窗口保留 30s 供你看结果）"); await page.waitForTimeout(30000); await browser.close(); }
