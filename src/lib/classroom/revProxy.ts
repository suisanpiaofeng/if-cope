/**
 * 本机反代（规格 §2；端口 3778，随应用启动）。
 * 职责：转发 cvs.seu.edu.cn + CAS 域，使 iframe 可内嵌官方页、浏览器可完成官方登录。
 *  · 剥框架/安全类响应头（X-Frame-Options 等 → iframe 可内嵌）
 *  · 改写 Set-Cookie（剥 Domain/Secure → 会话 Cookie 落 localhost，浏览器托管，重启免登录）
 *  · 改写重定向 Location（CAS 跨域链映射回 /__cas 前缀；未知域名回错误页，不透传跳出）
 *  · 改写 HTML/JS 响应体里的官方绝对地址（官方页写死的 https://cvs.seu.edu.cn 等）
 *  · CORS：放行 3777 的前端 fetch（带凭据）
 * 合规：只监听 127.0.0.1；只转发不落盘任何媒体与凭据（规格 §7）。
 * 健壮性（v1 教训）：无 cookie 时 delete 头（禁止赋 undefined）；handler 全 try/catch，
 * 上游错误一律降级 502 提示，绝不 throw 打挂主进程。
 */
import http from "node:http";
import https from "node:https";
import db from "@/lib/db";
import {
  PORT,
  CVS_HOST,
  CAS_HOSTS,
  CAS_LOGIN_PATH,
  rewriteSetCookie,
  rewriteLocation,
} from "./cookieRewrite";

/** /__whoami 探测用的官方轻量路径（真机联调确认：选一个未登录会 302 到 CAS 的路径） */
const WHOAMI_PATH = "/";

/** 剥掉的响应头（本地转发场景由我们自己说了算；Set-Cookie 不剥——登录态靠它落 localhost） */
const STRIP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-xss-protection",
  "x-download-options",
  "x-permitted-cross-domain-policies",
]);

const ORIGIN = `http://localhost:${PORT}`;
const CORS = {
  "access-control-allow-origin": "http://localhost:3777",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** settings 表里的手动 Cookie 兜底（网页登录失败时的保底路径，规格 §8） */
function manualCookie(): string {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'classroom.proxyCookie'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? "";
  } catch {
    return "";
  }
}

/** 响应体改写：仅 HTML/JS（官方页写死的绝对地址 → 反代地址） */
function rewriteBody(body: Buffer, contentType: string): Buffer {
  const ct = contentType.toLowerCase();
  if (!ct.includes("text/html") && !ct.includes("javascript")) return body;
  let text = body.toString("utf8");
  // CAS 域先替换（避免被 CVS 规则误伤）
  for (const host of CAS_HOSTS) {
    text = text.split(`https://${host}`).join(`${ORIGIN}/__cas`);
    text = text.split(`http://${host}`).join(`${ORIGIN}/__cas`);
    text = text.split(`//${host}`).join(`${ORIGIN}/__cas`);
  }
  text = text.split(`https://${CVS_HOST}`).join(ORIGIN);
  text = text.split(`http://${CVS_HOST}`).join(ORIGIN);
  text = text.split(`//${CVS_HOST}`).join(ORIGIN);
  return Buffer.from(text, "utf8");
}

function fail(res: http.ServerResponse, msg: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(502, { "content-type": "text/plain; charset=utf-8", ...CORS });
  res.end(msg);
}

/** 一次上游请求（不自动跟随重定向——重定向由 rewriteLocation 接管） */
function upstreamRequest(
  opts: { host: string; path: string; method: string; headers: http.OutgoingHttpHeaders },
  body: Buffer | null
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (ures) => {
      if ([301, 302, 303, 307, 308].includes(ures.statusCode ?? 0)) {
        ures.resume();
        resolve({ status: ures.statusCode!, headers: ures.headers, body: null });
        return;
      }
      const chunks: Buffer[] = [];
      ures.on("data", (c) => chunks.push(c));
      ures.on("end", () =>
        resolve({ status: ures.statusCode ?? 502, headers: ures.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** 拼上游请求头：cookie 优先浏览器自带（localhost:3778 域），无则用 settings 手动兜底 */
function buildHeaders(req: http.IncomingMessage, host: string, path: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  delete headers["accept-encoding"]; // 不压缩，便于改写
  delete headers["content-length"];
  headers.host = host;
  headers.referer = `https://${host}${path}`;
  headers.origin = `https://${host}`;
  const cookie = req.headers.cookie || manualCookie();
  if (cookie) headers.cookie = cookie; // v1 教训：无 cookie 时保持无头，禁止赋 undefined
  return headers;
}

/** 转发一个上游响应（含头/体改写） */
async function forward(
  res: http.ServerResponse,
  up: { status: number; headers: http.IncomingHttpHeaders; body: Buffer | null },
  opts: { isCas: boolean }
): Promise<void> {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(up.headers)) {
    const key = k.toLowerCase();
    if (STRIP.has(key)) continue;
    if (key === "set-cookie") {
      const list = Array.isArray(v) ? v : [String(v)];
      out["set-cookie"] = list.map(rewriteSetCookie);
      continue;
    }
    out[key] = v;
  }
  if (up.headers.location) {
    let loc = rewriteLocation(String(up.headers.location));
    // CAS 站内相对跳转：补 /__cas 前缀（否则会打回 CVS_HOST）
    if (loc === null) {
      fail(res, "登录跳转指向未知域名，已阻止（反代不透传外部跳转）");
      return;
    }
    if (opts.isCas && loc.startsWith("/")) loc = `/__cas${loc}`;
    out.location = loc;
  }
  Object.assign(out, CORS);
  let body = up.body;
  if (body) {
    const ct = String(up.headers["content-type"] ?? "");
    body = rewriteBody(body, ct);
    out["content-length"] = body.length;
  }
  res.writeHead(up.status, out);
  res.end(body ?? undefined);
}

async function proxyHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // 登录入口：302 到 CAS 登录页（经 /__cas 前缀）
  if (url === "/__login") {
    res.writeHead(302, { location: `/__cas${CAS_LOGIN_PATH}`, ...CORS });
    res.end();
    return;
  }

  // 登录态探测：上游 2xx 且无重定向 → 已登录；Location 指向 CAS → 未登录
  if (url.startsWith("/__whoami")) {
    try {
      const up = await upstreamRequest(
        { host: CVS_HOST, path: WHOAMI_PATH, method: "GET", headers: buildHeaders(req, CVS_HOST, WHOAMI_PATH) },
        null
      );
      if (up.status >= 200 && up.status < 300 && !up.headers.location) {
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ loggedIn: true }));
      } else {
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ loggedIn: false }));
      }
    } catch {
      fail(res, "代理错误：无法访问 CVS（确认本机在校园网/VPN 内）");
    }
    return;
  }

  // CAS 前缀路由
  if (url.startsWith("/__cas/")) {
    const casPath = url.slice("/__cas".length) || "/";
    try {
      const up = await upstreamRequest(
        { host: CAS_HOSTS[0], path: casPath, method: req.method ?? "GET", headers: buildHeaders(req, CAS_HOSTS[0], casPath) },
        null
      );
      await forward(res, up, { isCas: true });
    } catch (e) {
      fail(res, `代理错误：${e instanceof Error ? e.message : String(e)}（确认本机在校园网/VPN 内）`);
    }
    return;
  }

  // 默认：转发 CVS
  try {
    const headers = buildHeaders(req, CVS_HOST, url);
    let body: Buffer | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = chunks.length ? Buffer.concat(chunks) : null;
      if (body) headers["content-length"] = body.length;
    }
    const up = await upstreamRequest(
      { host: CVS_HOST, path: url, method: req.method ?? "GET", headers },
      body
    );
    await forward(res, up, { isCas: false });
  } catch (e) {
    fail(res, `代理错误：${e instanceof Error ? e.message : String(e)}（确认本机在校园网/VPN 内）`);
  }
}

let server: http.Server | null = null;

export function isRunning(): boolean {
  return server != null && server.listening;
}

/** 随应用启动（幂等；EADDRINUSE 只记日志不抛——绝不打挂主进程） */
export function startRevProxy(): void {
  if (server) return;
  server = http.createServer((req, res) => {
    proxyHandler(req, res).catch((e) => {
      // 兜底：任何漏网异常都不允许打挂主进程（v1 教训）
      try {
        fail(res, `代理内部错误：${e instanceof Error ? e.message : String(e)}`);
      } catch {
        /* res 已死，忽略 */
      }
    });
  });
  server.on("error", (e) => {
    console.error(`[cvs-proxy] 启动失败：${e.message}（端口 ${PORT} 被占？）`);
    server = null;
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[cvs-proxy] 反代已启动：http://localhost:${PORT} → https://${CVS_HOST}`);
  });
}
