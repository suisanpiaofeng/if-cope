// 联调探测：经反代加载 CVS，抓真实登录跳转地址 + API base + X-Frame 行为
import { chromium } from "playwright";

const PROXY = "http://localhost:3778";
const CVS_HOME = `${PROXY}/jy-application-resourcemanage-ui/`;

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const apiCalls = [];
const redirects = [];
const consoles = [];
page.on("request", (r) => {
  const u = r.url();
  if (!u.includes("/static/") && !u.includes(".js") && !u.includes(".css") && !u.includes(".png") && !u.includes(".ico")) apiCalls.push(`${r.method()} ${u.replace(PROXY, "")}`);
});
page.on("response", (r) => {
  const loc = r.headers()["location"];
  if (r.status() >= 300 && r.status() < 400 && loc) redirects.push(`${r.status()} ${r.url().replace(PROXY, "")} → ${loc}`);
});
page.on("console", (m) => consoles.push(`[${m.type()}] ${m.text().slice(0, 120)}`));

console.log("加载:", CVS_HOME);
await page.goto(CVS_HOME, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => console.log("goto:", e.message.split("\n")[0]));
await page.waitForTimeout(4000);

console.log("\n=== URL 终态 ===", page.url());
console.log("\n=== 非静态请求（前 25） ===");
[...new Set(apiCalls)].slice(0, 25).forEach((u) => console.log(" ", u));
console.log("\n=== 3xx 跳转 ===");
redirects.slice(0, 15).forEach((u) => console.log(" ", u));
console.log("\n=== 页面标题/可见文本 ===");
console.log(" title:", await page.title().catch(() => "?"));
console.log(" body:", (await page.evaluate(() => document.body?.innerText?.slice(0, 300) || "(空)").catch(() => "?")).replace(/\n/g, " | "));
console.log("\n=== 控制台（前 10） ===");
consoles.slice(0, 10).forEach((c) => console.log(" ", c));

await browser.close();
