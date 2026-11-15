/**
 * 项目 = 自由工作空间（OpenFic 对齐定稿 §3.2）：
 * 项目即树内顶层目录；标题与目录名解耦（创建时目录名定格，改标题不动目录）。
 * 无模板不限粒度：一门课/一次任务皆可，结构由学生/AI 自组织。
 */
import path from "node:path";

const ILLEGAL = /[\\/:*?"<>|]/g;

/** 项目标题 → 目录名（清洗/截 40/去重 -2/-3，大小写不敏感） */
export function projectDirName(title: string, taken: Set<string>): string {
  let base = String(title ?? "")
    .replace(ILLEGAL, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 40)
    .trim()
    .replace(/[. ]+$/g, "");
  if (!base) base = "未命名项目";
  const lower = (s: string) => s.toLowerCase();
  const takenLower = new Set([...(taken ?? [])].map(lower));
  if (!takenLower.has(lower(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}`;
    if (!takenLower.has(lower(cand))) return cand;
  }
  return `${base}-${Date.now()}`;
}

/** 树相对路径 → 所属项目目录名（首个路径段）；根级条目（无 /）返回 null */
export function deriveProjectFromPath(relPath: string): string | null {
  const norm = String(relPath ?? "").split("\\").join("/").replace(/^\/+/, "");
  const i = norm.indexOf("/");
  return i <= 0 ? null : norm.slice(0, i);
}
