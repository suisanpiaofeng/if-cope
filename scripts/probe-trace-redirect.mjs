// 自动复现登录链，追踪每个 3xx Location，抓出被反代拦截的域名
import { chromium } from "playwright";

const PROXY = "http://localhost:3778";
const CVS_HOME = `${PROXY}/jy-application-resourcemanage-ui/`;

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const mark = (s) => console.log(s);

// 追踪所有 3xx 的 Location（这是关键：看认证链往哪跳）
page.on("response", (r) => {
  const st = r.status();
  if (st >= 300 && st < 400) {
    const loc = r.headers()["location"] || "(无 location)";
    const from = r.url().replace(PROXY, "[PROXY]").slice(0, 70);
    mark(`[3xx ${st}] ${from}`);
    mark(`    → ${loc.slice(0, 200)}`);
  }
  // 抓到反代的拦截响应
  if (r.url().includes("localhost:3778")) {
    r.text().then((t) => {
      if (t.includes("已阻止") || t.includes("未知域名")) {
        mark(`  ❌❌ 拦截命中: ${t.replace(/\s+/g, " ").slice(0, 200)}`);
      }
    }).catch(() => {});
  }
});

mark("=== 自动加载登录链（无需手动）===");
mark("起点: " + CVS_HOME);
await page.goto(CVS_HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => mark("goto: " + e.message.split("\n")[0]));

// 跟随 SPA 自动跳转最多 25 秒
for (let i = 0; i < 13; i++) {
  await page.waitForTimeout(2000);
  const u = page.url();
  mark(`  [${((i + 1) * 2)}s] ${u.replace(PROXY, "[PROXY]").slice(0, 100)}`);
  if (u.includes("__cas/dist/#")) { mark("  → 已到认证中心登录页（此路径正常，未被拦）"); break; }
}

const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || "").catch(() => "");
mark("\n=== 落地页文本 ===");
mark(body.replace(/\n/g, " | ") || "(空)");

await browser.close();
