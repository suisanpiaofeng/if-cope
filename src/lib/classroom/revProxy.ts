/**
 * 本机反代（规格 §2；端口 3778，随应用启动）。
 * 职责：转发 cvs.seu.edu.cn + CAS 域，使 iframe 可内嵌官方页、浏览器可完成官方登录。
 *  · 剥框架/安全类响应头（X-Frame-Options 等 → iframe 可内嵌）
 *  · 改写 Set-Cookie（剥 Domain/Secure → 会话 Cookie 落 localhost，浏览器托管，重启免登录）
 *  · 改写重定向 Location（CAS 跨域链映射回 /__cas 前缀；未知域名回错误页，不透传跳出）
 *  · 改写 HTML/JS 响应体里的官方绝对地址（官方页写死的 https://cvs.seu.edu.cn 等）
 *  · CORS：放行 3777 的前端 fetch（带凭据）
 * 合规：只监听 127.0.0.1；只转发不落盘任何媒体（规格 §7）。
 * 会话 Cookie 仅存本机 settings 表（classroom.proxyCookie，与「Cookie 兑底」同键同库），
 * 用途：①网页登录失败时的手动兑底 ②会话保活（2026-11-10：CVS 会话闲置过期后接口报 500/401，
 * 自动定时续命后基本杜绝）。
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
  prefixForHost,
  rewriteSetCookie,
  rewriteLocation,
  rewriteBodyText,
} from "./cookieRewrite";

/** /__whoami 探测用的官方接口（真机实测：未登录 401，登录后 200） */
const WHOAMI_PATH = "/jy-application-resourcemanage/v1/web/login/acknowledge";
/** CVS 前端首页（登录入口：加载它即可触发官方自己的认证跳转链） */
const SPA_HOME = "/jy-application-resourcemanage-ui/";

/** 剥掉的响应头（本地转发场景由我们自己说了算；Set-Cookie 不剥——登录态靠它落 localhost）。
 *  www-authenticate 必剥：上游 401 带 Basic 质询会触发浏览器原生登录弹窗，
 *  而学校登录要手机验证码，弹窗永远登不上（2026-11-12 用户反馈）——改为页面引导新页登录。 */
const STRIP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-xss-protection",
  "x-download-options",
  "x-permitted-cross-domain-policies",
  "www-authenticate",
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

/** 会话保活（2026-11-10）：登录 Set-Cookie 流经反代、或浏览器带 Cookie 过来时自动记住会话 Cookie，
 *  startRevProxy 起 5 分钟定时器带它 ping 上游续命，闲置过期基本消失。 */
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let lastPersisted = ""; // 写库去重：同一串 Cookie 不反复写盘

function persistCookieString(cookie: string): void {
  if (!cookie || cookie === lastPersisted) return;
  lastPersisted = cookie;
  try {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('classroom.proxyCookie', ?)").run(cookie);
  } catch {
    /* 保活记录失败不影响转发 */
  }
}

/** Set-Cookie 列表 → 合并进会话 Cookie 串（同名覆盖；空值/Deleted 视为删除） */
function mergeSetCookies(setCookieList: string[]): void {
  const jar = new Map<string, string>();
  for (const p of manualCookie().split(";")) {
    const t = p.trim();
    const i = t.indexOf("=");
    if (i > 0) jar.set(t.slice(0, i), t.slice(i + 1));
  }
  for (const sc of setCookieList) {
    const pair = sc.split(";")[0].trim();
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const k = pair.slice(0, i);
    const v = pair.slice(i + 1);
    if (!v || v.toLowerCase() === "deleted") jar.delete(k);
    else jar.set(k, v);
  }
  persistCookieString([...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
}

/** 保活 ping：带存下的会话 Cookie 探登录态接口，使 CVS 服务端会话保持活跃。
 *  无 Cookie/失败都只记日志，绝不影响主流程。 */
function keepAlive(): void {
  const cookie = manualCookie();
  if (!cookie) return;
  upstreamRequest(
    {
      host: CVS_HOST,
      path: WHOAMI_PATH,
      method: "GET",
      headers: { host: CVS_HOST, referer: `https://${CVS_HOST}/`, accept: "application/json", cookie },
    },
    null
  )
    .then((up) => {
      const ok = up.status >= 200 && up.status < 300 && !up.headers.location;
      if (!ok) console.warn(`[cvs-proxy] 会话保活失败：HTTP ${up.status}（会话可能已过期，需重新登录）`);
    })
    .catch((e) => console.warn(`[cvs-proxy] 会话保活失败：${e instanceof Error ? e.message : String(e)}`));
}

/** 响应体改写：HTML/JS/JSON 里的校内绝对地址 → 反代地址（动态域，见 rewriteBodyText） */
function rewriteBody(body: Buffer, contentType: string, currentHost: string): Buffer {
  const ct = contentType.toLowerCase();
  const rewritable =
    ct.includes("text/html") ||
    ct.includes("javascript") ||
    ct.includes("json") || // 登录后 token/跳转常在 JSON 里返回绝对地址
    ct.includes("x-www-form-urlencoded");
  if (!rewritable) return body;
  const text = rewriteBodyText(body.toString("utf8"), currentHost);
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

/** 一次上游请求（不自动跟随重定向——重定向由 rewriteLocation 接管；15s 超时防校园网卡死把 UI 拖住）。
 *  注意：调用方传的是 host（目标主机），Node 的 https.request 需要 hostname（host 是本地接口地址，
 *  传 host 会连到 localhost 导致 ECONNRESET）。这里统一映射。 */
function upstreamRequest(
  opts: { host: string; path: string; method: string; headers: http.OutgoingHttpHeaders },
  body: Buffer | null
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: opts.host, path: opts.path, method: opts.method, headers: opts.headers, port: 443, servername: opts.host },
      (ures) => {
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
    req.setTimeout(15000, () => {
      req.destroy(new Error("上游响应超时（15s）——确认校园网/VPN 连通"));
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
  // 浏览器带的会话 Cookie 也记下来供保活（覆盖重启前已登录的旧会话）
  if (req.headers.cookie && host === CVS_HOST) persistCookieString(req.headers.cookie);
  return headers;
}

/** 转发一个上游响应（含头/体改写） */
async function forward(
  res: http.ServerResponse,
  up: { status: number; headers: http.IncomingHttpHeaders; body: Buffer | null },
  opts: { isCas: boolean; host?: string; prefix?: string }
): Promise<void> {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(up.headers)) {
    const key = k.toLowerCase();
    if (STRIP.has(key)) continue;
    if (key === "set-cookie") {
      const list = Array.isArray(v) ? v : [String(v)];
      out["set-cookie"] = list.map(rewriteSetCookie);
      // 登录链路上游发的新会话 Cookie → 记下来供保活（仅 CVS 域，CAS 登录票据不存）
      if (!opts.isCas && (opts.host ?? CVS_HOST) === CVS_HOST) mergeSetCookies(list);
      continue;
    }
    out[key] = v;
  }
  if (up.headers.location) {
    let loc = rewriteLocation(String(up.headers.location));
    // CAS 站内相对跳转：补 /__cas 前缀（否则会打回 CVS_HOST）
    if (loc === null) {
      const rawLoc = String(up.headers.location);
      console.warn(`[cvs-proxy] 阻止外域跳转: ${rawLoc}（来自 ${opts.host ?? CVS_HOST}）`);
      fail(res, `登录跳转指向未知域名，已阻止：${rawLoc.slice(0, 160)}`);
      return;
    }
    const prefix = opts.prefix ?? (opts.isCas ? "/__cas" : "");
    if (prefix && loc.startsWith("/")) loc = `${prefix}${loc}`;
    out.location = loc;
  }
  Object.assign(out, CORS);
  // 响应体已在 upstreamRequest 整体缓冲，Transfer-Encoding 不可与 Content-Length 并存
  // （非法 HTTP 响应，浏览器宽容但严格客户端直接拒收——2026-11-10 Node 撞墙实测）
  delete out["transfer-encoding"];
  let body = up.body;
  if (body) {
    const ct = String(up.headers["content-type"] ?? "");
    body = rewriteBody(body, ct, opts.host ?? CVS_HOST);
    out["content-length"] = body.length;
  }
  res.writeHead(up.status, out);
  res.end(body ?? undefined);
}

async function proxyHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  // 请求完成日志：method/url/状态/耗时（定位“卡在哪个请求”的运维能力，无副作用）
  const t0 = Date.now();
  res.on("finish", () => {
    console.log(`[cvs-proxy] ${req.method} ${url.slice(0, 140)} → ${res.statusCode} (${Date.now() - t0}ms)`);
  });

  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // 登录入口：不猜任何认证路径——302 到 CVS 官网，SPA 自己会跳到
  // 「东南大学身份认证中心」登录页（真实探测：整条 OAuth 链经反代完好，
  //  return_uri 自动带 localhost:3778，登录后回跳反代）
  if (url === "/__login") {
    res.writeHead(302, { location: SPA_HOME, ...CORS });
    res.end();
    return;
  }

  // 版本哨兵：验证 3778 上跑的确实是最新编译（多轮重启曾遇旧进程残留）
  if (url === "/__canary") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...CORS });
    res.end("proxy-v8-minimal-20261030");
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
        // 401/302/404 一律判未登录（宁可让用户点登录，不可误报已登录）
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ loggedIn: false }));
      }
    } catch {
      fail(res, "代理错误：无法访问 CVS（确认本机在校园网/VPN 内）");
    }
    return;
  }

  // CAS 前缀路由（登录 POST 的请求体必须转发，否则认证服务器收到空请求回「系统繁忙」）
  if (url.startsWith("/__cas/")) {
    const casPath = url.slice("/__cas".length) || "/";
    try {
      const headers = buildHeaders(req, CAS_HOSTS[0], casPath);
      let body: Buffer | null = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = chunks.length ? Buffer.concat(chunks) : null;
        if (body) headers["content-length"] = body.length;
      }
      const up = await upstreamRequest(
        { host: CAS_HOSTS[0], path: casPath, method: req.method ?? "GET", headers },
        body
      );
      await forward(res, up, { isCas: true, host: CAS_HOSTS[0], prefix: "/__cas" });
    } catch (e) {
      fail(res, `代理错误：${e instanceof Error ? e.message : String(e)}（确认本机在校园网/VPN 内）`);
    }
    return;
  }

  // 动态校内域路由：/__h/<host>/... → https://<host>/...
  // 覆盖登录后跳转链经过的任意 *.seu.edu.cn（ids/cas/cloud-rbac 等），不必枚举
  if (url.startsWith("/__h/")) {
    const rest = url.slice("/__h/".length);
    const slash = rest.indexOf("/");
    const host = slash === -1 ? rest : rest.slice(0, slash);
    const subPath = slash === -1 ? "/" : rest.slice(slash);
    const prefix = `/__h/${host}`;
    const upstreamHost = prefixForHost(host);
    if (upstreamHost === null) {
      fail(res, `已阻止非校内域代理请求：${host}`);
      return;
    }
    try {
      const headers = buildHeaders(req, host, subPath);
      let body: Buffer | null = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = chunks.length ? Buffer.concat(chunks) : null;
        if (body) headers["content-length"] = body.length;
      }
      const up = await upstreamRequest({ host, path: subPath, method: req.method ?? "GET", headers }, body);
      await forward(res, up, { isCas: false, host, prefix });
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
    if (!keepAliveTimer) {
      keepAliveTimer = setInterval(keepAlive, KEEPALIVE_INTERVAL_MS);
      keepAliveTimer.unref?.(); // 不阻塞进程退出
      console.log("[cvs-proxy] 会话保活已启用：每 5 分钟自动续命（有会话 Cookie 时）");
    }
  });
}
