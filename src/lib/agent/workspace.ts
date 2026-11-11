/**
 * 工作区（harness P0 规格 §3.1）：文件工具 / 命令执行的唯一根。
 * root 解析：IFCOPE_WORKSPACE_DIR > settings.workspacePath > <cwd>/data/workspace。
 * 所有工具路径必须经 resolveInWorkspace 前缀检查落在 root 内（路径穿越双保险）。
 */
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "../db.ts";

export type FileNode = { name: string; path: string; type: "file" | "dir"; size?: number; mtime?: number };

/** 工作区根目录（绝对路径） */
export function workspaceRoot(): string {
  if (process.env.IFCOPE_WORKSPACE_DIR) return path.resolve(process.env.IFCOPE_WORKSPACE_DIR);
  const configured = String(getSettings().workspacePath ?? "").trim();
  return path.resolve(configured || path.join(process.cwd(), "data", "workspace"));
}

/** 确保根目录存在 */
export function ensureWorkspace(): void {
  fs.mkdirSync(workspaceRoot(), { recursive: true });
}

/** 解析工作区内路径（相对/绝对均可）；越界 throw「路径超出工作区」 */
export function resolveInWorkspace(p: string): string {
  const root = workspaceRoot();
  const target = path.resolve(root, String(p ?? "").trim());
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`路径超出工作区：${p}`);
  }
  return target;
}

/** 绝对路径 → 工作区相对路径（`/` 分隔） */
export function relPath(abs: string): string {
  return path.relative(workspaceRoot(), abs).split(path.sep).join("/");
}

/** 文件树：默认深度 2 层；单目录条目 ≤200；目录优先排序 */
export function listFilesTree(rel: string = "", depth: number = 2): FileNode[] {
  const base = resolveInWorkspace(rel);
  const out: FileNode[] = [];
  const walk = (dirAbs: string, level: number) => {
    if (level > depth) return;
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).slice(0, 200);
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      const abs = path.join(dirAbs, e.name);
      const node: FileNode = {
        name: e.name,
        path: relPath(abs),
        type: e.isDirectory() ? "dir" : "file",
      };
      if (!e.isDirectory()) {
        const st = fs.statSync(abs);
        node.size = st.size;
        node.mtime = st.mtimeMs;
      }
      out.push(node);
      if (e.isDirectory()) walk(abs, level + 1);
    }
  };
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) walk(base, 1);
  return out;
}
