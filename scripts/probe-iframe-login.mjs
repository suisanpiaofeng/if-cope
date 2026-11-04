// 验证：内嵌 iframe 里登录后是否留在内嵌（不跳顶层）
import { chromium } from "playwright";

const APP = "http://localhost:3777/classroom";
const PROXY = "http://localhost:3778";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const log = [];
const note = (s) => { log.push(s); console.log(s); };

// 监测顶层导航（跳出 iframe 的信号）
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) note(`[顶层导航] ${f.url().slice(0, 90)}`);
});

note("加载课堂页…");
await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => note("goto: " + e.message));

// 同意声明（若有）
await page.waitForTimeout(2500);
const acceptBtn = await page.$('button:has-text("我已阅读并同意")').catch(() => null);
if (acceptBtn) { await acceptBtn.click(); note("已同意声明"); await page.waitForTimeout(1500); }

// 找内嵌 iframe
const frames = page.frames();
note(`frame 数: ${frames.length}`);
for (const f of frames) note(`  frame: ${f.url().slice(0, 90)}`);

const iframe = page.frames().find((f) => f.url().includes("3778"));
if (!iframe) {
  note("❌ 未找到指向反代的 iframe");
  const html = await page.content().catch(() => "");
  note("iframe 片段: " + (html.match(/<iframe[^>]*>/g) || ["(无)"]).join(" "));
} else {
  note("✓ 找到内嵌 iframe: " + iframe.url().slice(0, 90));
  // 等 iframe 内容稳定（可能跳到认证中心登录页）
  await page.waitForTimeout(6000);
  const bodyText = await iframe.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "(空)").catch((e) => "ERR: " + e.message);
  note("iframe 内文本: " + bodyText.replace(/\n/g, " | "));
  const finalUrl = iframe.url();
  note("iframe 最终 URL: " + finalUrl.slice(0, 120));
  const isLoginPage = /登录|认证|密码|一卡通|统一身份/.test(bodyText) || finalUrl.includes("/__cas/");
  note(isLoginPage ? "✅ iframe 内已呈现登录页（学生可直接在此登录）" : "⚠️ iframe 内未见登录页");
}

// 检查顶层是否被跳出（顶层应仍是课堂页）
const topUrl = page.url();
note("顶层 URL: " + topUrl.slice(0, 90));
note(topUrl.includes("/classroom") ? "✅ 顶层仍在课堂页（未被顶掉）" : "❌ 顶层已跳出课堂页");

await browser.close();
