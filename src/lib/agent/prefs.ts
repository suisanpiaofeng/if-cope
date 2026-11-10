/**
 * 偏好库存储（二期规格 §3.2，plan Task 1）。
 * 对话里"记住：…"经 save_preference 工具写入；启动时经 buildUserSection 注入所有 LLM 场景。
 * 幂等：同文本不重复落库；上限 PREFS_MAX 条。
 */
import db from "../db.ts";

export type UserPref = { id: number; text: string };

export const PREFS_MAX = 50;

/** 全部偏好（id 升序） */
export function listPrefs(): UserPref[] {
  return db.prepare("SELECT id, text FROM user_prefs ORDER BY id ASC").all() as UserPref[];
}

/** 存一条偏好（幂等：同文本已存在返回 created:false）；空白文本 throw */
export function savePref(text: string): { id: number; created: boolean } {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("偏好文本不能为空");
  const exist = db.prepare("SELECT id FROM user_prefs WHERE text = ?").get(t) as { id: number } | undefined;
  if (exist) return { id: exist.id, created: false };
  const info = db.prepare("INSERT INTO user_prefs (text, created_at) VALUES (?, ?)").run(t, Date.now());
  return { id: Number(info.lastInsertRowid), created: true };
}

/** 删除一条偏好；不存在返回 false */
export function deletePref(id: number): boolean {
  const r = db.prepare("DELETE FROM user_prefs WHERE id = ?").run(id);
  return r.changes > 0;
}

/** 已存条数（上限检查用） */
export function countPrefs(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM user_prefs").get() as { n: number }).n;
}

/** 组装 <user_profile> 注入区（用户指令 + 长期偏好）；都空返回 ""；拼好后截 2000 字符 */
export function buildUserSection(userDirective: string, prefs: UserPref[]): string {
  const directive = String(userDirective ?? "").trim();
  if (!directive && !prefs.length) return "";
  const lines: string[] = ["<user_profile>"];
  if (directive) {
    lines.push("【用户指令】", directive);
  }
  if (prefs.length) {
    lines.push("【长期偏好】");
    for (const p of prefs) lines.push(`- ${p.text}`);
  }
  lines.push("</user_profile>");
  return lines.join("\n").slice(0, 2000);
}
