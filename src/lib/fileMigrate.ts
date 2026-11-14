/**
 * 散列存储 → 统一文件树迁移（harness P3-1，规格 §3）：
 * data/uploads/<uuid>.<ext> → data/workspace/资料/<标题>.<ext>；sources.path 落相对路径。
 * 幂等：只处理 path IS NULL 的 file 类资料；文件内容不动 → chunks/向量全部有效。
 */
import fs from "node:fs";
import path from "node:path";
import db from "./db.ts";
import { titleToFilename, sourcePath } from "./fileTree.ts";
import { workspaceRoot } from "./agent/workspace.ts";

export type MigrateReport = {
  migrated: Array<{ id: number; title: string; to: string }>;
  skipped: Array<{ id: number; reason: string }>;
};

/** 执行迁移（幂等，可重复跑） */
export function migrateUploadsToTree(): MigrateReport {
  const report: MigrateReport = { migrated: [], skipped: [] };
  const rows = db
    .prepare("SELECT id, title, ext, filename, path FROM sources WHERE path IS NULL AND source_type = 'file'")
    .all() as Array<{ id: number; title: string; ext: string; filename: string; path: string | null }>;
  if (!rows.length) return report;

  const dir = path.join(workspaceRoot(), "资料");
  fs.mkdirSync(dir, { recursive: true });
  const taken = new Set(fs.readdirSync(dir));

  for (const r of rows) {
    const from = sourcePath(r);
    if (!fs.existsSync(from)) {
      report.skipped.push({ id: r.id, reason: "原始文件缺失" });
      continue;
    }
    const name = titleToFilename(r.title, r.ext || path.extname(r.filename).replace(".", ""), taken);
    taken.add(name);
    const rel = `资料/${name}`;
    try {
      fs.copyFileSync(from, path.join(workspaceRoot(), rel));
      db.prepare("UPDATE sources SET path = ? WHERE id = ?").run(rel, r.id);
      report.migrated.push({ id: r.id, title: r.title, to: rel });
    } catch (e) {
      report.skipped.push({ id: r.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

/** 迁移是否待办（树接口懒触发用） */
export function migrationPending(): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sources WHERE path IS NULL AND source_type = 'file'")
    .get() as { n: number };
  return row.n > 0;
}
