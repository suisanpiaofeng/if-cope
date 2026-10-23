// CVS 反向代理原型（路线"内置显示框"复活方案）
// 用法：
//   1. 把登录 cvs.seu.edu.cn 后浏览器里的 Cookie 头整行粘进 verify/cvs-cookie.txt
//   2. node verify/cvs-proxy.js
//   3. 打开 verify/proxy-frame-test.html
// 原理：本机 Node（校园网内）转发请求到 cvs.seu.edu.cn，服务端代带 Cookie，
//      并剥掉 X-Frame-Options / CSP 等响应头 → iframe 可以内嵌自家源的转发页面。
// 合规边界：仅用于本人已授权课程的本地观看，与 cvs-replay-notes-skill 同一性质；
//          公开部署此"镜像"能力前必须获得学校同意（本地/校内托管可先行）。

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 3778;
const UPSTREAM = "cvs.seu.edu.cn";
const COOKIE_FILE = path.join(__dirname, "cvs-cookie.txt");

function readCookie() {
  try {
    return fs.readFileSync(COOKIE_FILE, "utf8").replace(/[\r\n]+/g, " ").trim();
  } catch {
    return "";
  }
}

// 剥掉的响应头：框架/安全类（本地转发场景下由我们自己说了算）
const STRIP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "set-cookie", // 上游 cookie 绑的是 cvs 域，不适用 localhost，登录态由服务端代带
  "x-xss-protection",
  "x-download-options",
  "x-permitted-cross-domain-policies",
]);

const server = http.createServer((req, res) => {
  const cookie = readCookie();
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["accept-encoding"]; // 不走压缩，方便后续需要时改写内容
  headers.host = UPSTREAM;
  if (cookie) headers.cookie = cookie;
  // 模拟"用户就在 cvs 站内"的请求上下文，避免 Referer/Origin 校验挡 POST
  headers.referer = `https://${UPSTREAM}${req.url}`;
  headers.origin = `https://${UPSTREAM}`;

  const up = https.request(
    { host: UPSTREAM, port: 443, path: req.url, method: req.method, headers },
    (upRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        const key = k.toLowerCase();
        if (STRIP.has(key)) continue;
        out[key] = v;
      }
      if (upRes.headers.location) {
        out.location = String(upRes.headers.location)
          .replace(`https://${UPSTREAM}`, `http://localhost:${PORT}`)
          .replace(`http://${UPSTREAM}`, `http://localhost:${PORT}`);
      }
      res.writeHead(upRes.statusCode || 502, out);
      upRes.pipe(res);
    }
  );
  up.on("error", (e) => {
    console.error("[proxy error]", req.url, e.message);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("代理错误：" + e.message + "\n（确认本机在校园网/VPN 内）");
  });
  req.pipe(up);
  console.log(`${req.method} ${req.url}${cookie ? "  [带Cookie]" : "  [⚠ 无Cookie]"}`);
});

server.listen(PORT, () => {
  console.log(`CVS 反代已启动：http://localhost:${PORT}  →  https://${UPSTREAM}`);
  console.log(`Cookie 文件：${COOKIE_FILE}  ${readCookie() ? "（已读到）" : "（⚠ 不存在/为空，先粘贴 Cookie）"}`);
  console.log(`体验入口：http://localhost:${PORT}/jy-application-resourcemanage-ui/#/home`);
});
