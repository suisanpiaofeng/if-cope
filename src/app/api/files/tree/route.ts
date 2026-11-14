import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import db from "@/lib/db";
import { workspaceRoot, relPath } from "@/lib/agent/workspace";
import { filePreviewKind } from "@/lib/preview";
import { migrateUploadsToTree, migrationPending } from "@/lib/fileMigrate";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_NODES = 3000;

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  mtime?: number;
  kind?: string | null;
  sourceId?: number | null;
  indexed?: boolean;
  chunkCount?: number;
  status?: string;
};

/** 统一文件树数据（harness P3-1 §6）：fs 树 + sources 索引元数据合并；待迁移时先懒迁移 */
export async function GET() {
  if (migrationPending()) {
    try {
      migrateUploadsToTree();
    } catch { /* 迁移失败不阻塞浏览，可经 /api/files/migrate 重试 */ }
  }
  const root = workspaceRoot();
  const meta = new Map<string, { id: number; chunk_count: number; status: string }>();
  for (const r of db
    .prepare("SELECT id, path, chunk_count, status FROM sources WHERE path IS NOT NULL")
    .all() as Array<{ id: number; path: string; chunk_count: number; status: string }>) {
    meta.set(r.path.split("\\").join("/"), r);
  }

  const nodes: TreeNode[] = [];
  const walk = (dirAbs: string) => {
    if (nodes.length >= MAX_NODES) return;
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (nodes.length >= MAX_NODES) return;
      const abs = path.join(dirAbs, e.name);
      const rel = relPath(abs);
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: rel, type: "dir" });
        walk(abs);
      } else {
        const st = fs.statSync(abs);
        const m = meta.get(rel);
        const ext = path.extname(e.name).replace(".", "").toLowerCase();
        nodes.push({
          name: e.name,
          path: rel,
          type: "file",
          size: st.size,
          mtime: Math.round(st.mtimeMs),
          kind: filePreviewKind(ext),
          sourceId: m?.id ?? null,
          indexed: m ? m.status !== "skipped" && m.chunk_count > 0 : false,
          chunkCount: m?.chunk_count ?? 0,
          status: m?.status,
        });
      }
    }
  };
  walk(root);
  return NextResponse.json({ root, nodes, truncated: nodes.length >= MAX_NODES });
}
