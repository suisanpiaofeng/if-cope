// 反代改写纯函数验证（规格 Review Focus #1/#2：Set-Cookie 改写、CAS 重定向映射）
// 运行：node scripts/verify-revproxy-fn.mjs（Node ≥22.6 原生 TS 支持）
import assert from "node:assert/strict";
import { rewriteSetCookie, rewriteLocation } from "../src/lib/classroom/cookieRewrite.ts";

// Set-Cookie：剥 Domain 与 Secure（浏览器在 localhost http 下会拒收这两者），保留 HttpOnly/Path/SameSite
assert.equal(
  rewriteSetCookie("a=1; Domain=.seu.edu.cn; Path=/; Secure; HttpOnly"),
  "a=1; Path=/; HttpOnly"
);
// 无 Domain/Secure 时原样
assert.equal(rewriteSetCookie("b=2; Path=/"), "b=2; Path=/");
// Path 统一改写为 /（官方会话 Cookie 原 Path 限定在 /jy-application-resourcemanage 前缀下，
// 浏览器对 /__whoami 等反代自有路径不匹配就不携带——2026-11-09 真机实测根因）
assert.equal(
  rewriteSetCookie("JSESSIONID=abc; Path=/jy-application-resourcemanage; HttpOnly"),
  "JSESSIONID=abc; Path=/; HttpOnly"
);
// 无 Path 时补 Path=/（默认 Path 是请求目录，跨前缀会丢）
assert.equal(rewriteSetCookie("route=xyz"), "route=xyz; Path=/");

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

// 导航收敛脚本注入已随原生 UI 改造移除（规格 2026-11-09 §7：彻底移除 iframe，不再需要在 HTML 里注入导航收敛/上报脚本）

console.log("PASS: cookieRewrite 全部断言通过");
