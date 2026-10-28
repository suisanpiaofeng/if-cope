/**
 * 反代改写纯函数（规格 §2.2；零依赖，便于独立验证）。
 * 背景：登录态 Cookie 由 CAS 下发、绑在 *.seu.edu.cn 域且带 Secure；
 * 反代要让它落在 localhost(http) —— 浏览器才会收下并在后续请求自动带上。
 * 域名映射：CVS_HOST → 反代根；CAS_HOSTS → /__cas 前缀；未知域名 → null（禁止透传跳出）。
 */

export const PORT = 3778;
export const CVS_HOST = "cvs.seu.edu.cn";
/** 真机联调确认（规格 §8 未决 2）：实际 CAS 域可能不止一个 */
export const CAS_HOSTS = ["auth.seu.edu.cn", "ids.seu.edu.cn"];
/** CAS 登录路径（真机联调确认） */
export const CAS_LOGIN_PATH = "/cas/login";

/** 逐属性拆分（保留顺序），重拼时去掉 Domain 与 Secure */
export function rewriteSetCookie(value: string): string {
  const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => {
    const name = p.split("=")[0].trim().toLowerCase();
    return name !== "domain" && name !== "secure";
  });
  return kept.join("; ");
}

/** Location 改写：已知官方域名映射回反代；未知域名返回 null（不透传） */
export function rewriteLocation(location: string): string | null {
  if (/^https?:\/\//i.test(location)) {
    const m = location.match(/^(https?):\/\/([^/:?#]+)(:\d+)?([/?#].*)?$/i);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    const host = m[2].toLowerCase();
    const rest = m[4] ?? "/";
    if (host === CVS_HOST) return `http://localhost:${PORT}${rest}`;
    if (CAS_HOSTS.includes(host)) return `http://localhost:${PORT}/__cas${rest}`;
    return null;
  }
  // 协议相对 //host/path
  if (location.startsWith("//")) {
    return rewriteLocation("https:" + location);
  }
  // 站内相对路径：原样（浏览器会打回反代）
  if (location.startsWith("/")) return location;
  return null;
}
