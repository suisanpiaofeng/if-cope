// 反代改写纯函数验证（规格 Review Focus #1/#2：Set-Cookie 改写、CAS 重定向映射）
// 运行：node scripts/verify-revproxy-fn.mjs（Node ≥22.6 原生 TS 支持）
import assert from "node:assert/strict";
import { rewriteSetCookie, rewriteLocation, injectFrameNavScript } from "../src/lib/classroom/cookieRewrite.ts";

// Set-Cookie：剥 Domain 与 Secure（浏览器在 localhost http 下会拒收这两者），保留 HttpOnly/Path/SameSite
assert.equal(
  rewriteSetCookie("a=1; Domain=.seu.edu.cn; Path=/; Secure; HttpOnly"),
  "a=1; Path=/; HttpOnly"
);
// 无 Domain/Secure 时原样
assert.equal(rewriteSetCookie("b=2; Path=/"), "b=2; Path=/");

// Location：CAS 域 → /__cas 前缀
assert.equal(
  rewriteLocation("https://auth.seu.edu.cn/cas/login?x=1"),
  "http://localhost:3778/__cas/cas/login?x=1"
);
// Location：CVS 域 → 反代根
assert.equal(rewriteLocation("https://cvs.seu.edu.cn/home"), "http://localhost:3778/home");
assert.equal(rewriteLocation("http://cvs.seu.edu.cn/home"), "http://localhost:3778/home");
// Location：未知域名 → null（调用方回错误页，不透传跳出反代）
assert.equal(rewriteLocation("https://evil.example.com/"), null);

// 导航收敛脚本注入：插到 <head> 之后（官方脚本之前执行）
const injected = injectFrameNavScript("<html><head><title>x</title></head><body></body></html>");
assert.ok(injected.indexOf("data-ifcope-frame-nav") < injected.indexOf("<title>"), "脚本应插在 head 内容之前");
assert.ok(injected.includes("window.open = function"), "应覆盖 window.open");
assert.ok(injected.includes("preventDefault"), "应拦截非 _self 链接");
assert.ok(injected.includes("MutationObserver"), "应处理动态渲染的卡片");
assert.ok(injected.includes("postMessage"), "应向宿主页上报导航");
assert.ok(injected.includes("/__whoami"), "应同源探测登录态");
assert.ok(injected.includes("pushState"), "应鉤 SPA 路由变化");
assert.ok(injected.includes("'ifcope-frame'"), "上报消息带来源标识（宿主页校验 origin+source）");
assert.ok(injected.includes("'ifcope-host'"), "应监听宿主导航指令（主页）");
assert.ok(!injected.includes("seenTecl"), "tecl 捕获已随旧功能移除");
// 无 head 的 HTML：脚本前置，不破坏原文
const noHead = injectFrameNavScript("<div>hi</div>");
assert.ok(noHead.startsWith("<script data-ifcope-frame-nav>"), "无 head 时前置注入");
assert.ok(noHead.endsWith("<div>hi</div>"), "原文保留");
// 幂等性参考：已注入的页面不应二次破坏结构（仅验证不抛错、原文保留）
assert.ok(injectFrameNavScript(injected).includes("<title>x</title>"));

console.log("PASS: cookieRewrite 全部断言通过");
