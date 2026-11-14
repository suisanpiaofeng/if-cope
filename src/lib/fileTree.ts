/**
 * 统一文件树（harness P3-1，规格 2026-11-14 §2/§3）：
 * 位置=路径；sources.path 指向树内真实文件；旧散列文件（uploads/<uuid>）迁移前由 sourcePath 兜底。
 */
import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./agent/workspace.ts";

const ILLEGAL = /[\\/:*?"<>|]/g;

/** 标题 → 文件名（清洗非法字符/去首尾点空格/截 80 字；taken 大小写不敏感去重 -2/-3） */
export function titleToFilename(title: string, ext: string, taken: Set<string>): string {
  let base = String(title ?? "")
    .replace(ILLEGAL, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim()
    .replace(/[. ]+$/g, "");
  if (!base || base === "." || base === "..") base = "未命名";
  const e = String(ext ?? "").replace(/^\./, "");
  const lower = (s: string) => s.toLowerCase();
  const takenLower = new Set([...(taken ?? [])].map(lower));
  const name = e ? `${base}.${e}` : base;
  if (!takenLower.has(lower(name))) return name;
  for (let i = 2; i < 1000; i++) {
    const cand = e ? `${base}-${i}.${e}` : `${base}-${i}`;
    if (!takenLower.has(lower(cand))) return cand;
  }
  return `${base}-${Date.now()}${e ? "." + e : ""}`;
}

/** source → 绝对文件路径：path（树内相对）优先；旧散列文件兜底 data/uploads/<filename|storage_name> */
export function sourcePath(s: { path?: string | null; filename?: string | null; storage_name?: string | null }): string {
  if (s.path) return path.join(workspaceRoot(), s.path);
  return path.join(process.cwd(), "data", "uploads", path.basename(s.filename ?? s.storage_name ?? ""));
}

/** 写入树内文件（自动去重命名，返回树相对路径）。dirRel 缺省 资料/ */
export function writeTreeFile(buffer: Buffer, title: string, ext: string, dirRel: string = "资料"): string {
  const dir = path.join(workspaceRoot(), dirRel);
  fs.mkdirSync(dir, { recursive: true });
  const taken = new Set(fs.readdirSync(dir));
  const name = titleToFilename(title, ext, taken);
  fs.writeFileSync(path.join(dir, name), buffer);
  return `${dirRel}/${name}`;
}
