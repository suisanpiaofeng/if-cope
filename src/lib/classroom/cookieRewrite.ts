/**
 * 反代改写纯函数（规格 §2.2；零依赖，便于独立验证）。
 * 域名映射（动态，不枚举猜域名——真机登录后跳转链会经过任意校内域）：
 *  - cvs.seu.edu.cn       → 反代根
 *  - auth.seu.edu.cn 等已知认证域 → /__cas 前缀
 *  - 其余任意 *.seu.edu.cn → /__h/<host> 前缀
 *  - 非 *.seu.edu.cn      → null（禁止透传跳出反代，防 SSRF）
 */

export const PORT = 3778;
export const CVS_HOST = "cvs.seu.edu.cn";
/** 已知认证中心域（登录页资源走 /__cas 固定前缀） */
export const CAS_HOSTS = ["auth.seu.edu.cn"];

/** host → 反代路径前缀；非校内域返回 null（禁止） */
export function prefixForHost(host: string): string | null {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h)) return null; // 防 userinfo/怪字符 SSRF
  if (h === CVS_HOST) return "";
  if (CAS_HOSTS.includes(h)) return "/__cas";
  if (h === "seu.edu.cn" || h.endsWith(".seu.edu.cn")) return `/__h/${h}`;
  return null;
}

/** 逐属性拆分（保留顺序），重拼时：去掉 Domain/Secure（让 Cookie 落 localhost）；
 *  Path 统一改写为 /（官方会话 Cookie 原本 Path 限定在 /jy-application-resourcemanage 前缀下，
 *  浏览器对反代自有路径 /__whoami 等不匹配就不携带——2026-11-09 真机实测：acknowledge 带前缀 200、/__whoami 401） */
export function rewriteSetCookie(value: string): string {
  const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  let hasPath = false;
  for (const p of parts) {
    const name = p.split("=")[0].trim().toLowerCase();
    if (name === "domain" || name === "secure") continue;
    if (name === "path") {
      hasPath = true;
      kept.push("Path=/");
      continue;
    }
    kept.push(p);
  }
  if (!hasPath) kept.push("Path=/");
  return kept.join("; ");
}

/** Location 改写：校内域名映射回反代；已指向反代的 localhost 地址原样放行（官方 return_uri 回跳）；外域 null（不透传） */
export function rewriteLocation(location: string): string | null {
  if (/^https?:\/\//i.test(location)) {
    const m = location.match(/^https?:\/\/([^/:?#]+)(:\d+)?([/?#].*)?$/i);
    if (!m) return null;
    const host = m[1].toLowerCase();
    const rest = m[3] ?? "/";
    // 官方登录完成后按 return_uri 跳回 localhost:3778 —— 已是反代地址，原样放行
    if (host === "localhost" || host === "127.0.0.1") {
      return `http://localhost:${PORT}${rest}`;
    }
    const prefix = prefixForHost(host);
    if (prefix === null) return null;
    return `http://localhost:${PORT}${prefix}${rest}`;
  }
  // 协议相对 //host/path
  if (location.startsWith("//")) {
    return rewriteLocation("https:" + location);
  }
  // 站内相对路径：原样（调用方按当前前缀补齐）
  if (location.startsWith("/")) return location;
  return null;
}

/** 响应体改写：把 HTML/JS/JSON 里写死的校内绝对地址映射回反代。
 *  currentHost = 本响应来自哪个上游域（决定它的地址映射到自己的前缀）。 */
export function rewriteBodyText(text: string, currentHost: string): string {
  const map = new Map<string, string>();
  map.set(CVS_HOST, "");
  for (const h of CAS_HOSTS) map.set(h, "/__cas");
  const cur = currentHost.toLowerCase();
  const curPrefix = prefixForHost(cur);
  if (curPrefix !== null) map.set(cur, curPrefix);

  let out = text;
  for (const [host, prefix] of map) {
    const target = `http://localhost:${PORT}${prefix}`;
    out = out.split(`https://${host}`).join(target);
    out = out.split(`http://${host}`).join(target);
    out = out.split(`//${host}`).join(target);
  }
  return out;
}
