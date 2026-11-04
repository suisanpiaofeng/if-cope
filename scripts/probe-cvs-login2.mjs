// 深探：登录页经反代的完整资源加载 + 真实 500 来源
import { chromium } from "playwright";
const PROXY = "http://localhost:3778";
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(PROXY, "")}`); });

// 直接加载登录页（探测得到的真实地址，去掉 hash 前的查询干扰）
await page.goto(`${PROXY}/jy-application-resourcemanage-ui/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);

console.log("=== 终态 URL ===\n", page.url().replace(PROXY, "[PROXY]"), "\n");
console.log("=== 登录表单元素 ===");
const inputs = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => `${i.type} name=${i.name || i.placeholder || "?"}`)).catch(() => []);
inputs.forEach((i) => console.log("  input:", i));
const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean)).catch(() => []);
console.log("  buttons:", JSON.stringify(buttons));
console.log("\n=== 失败请求（>=400） ===");
[...new Set(failed)].forEach((f) => console.log("  ", f));
console.log("\n=== 登录页可见文本 ===");
console.log(" ", (await page.evaluate(() => document.body?.innerText?.slice(0, 400) || "").catch(() => "")).replace(/\n/g, " | "));

await browser.close();
