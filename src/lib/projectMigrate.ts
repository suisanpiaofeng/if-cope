/**
 * 项目迁移（OpenFic 对齐 P4-1 T2，规格 §3.3）：
 * 顶层目录 → projects 记录；文件归属按 path 首段派生；根平铺文件不归属（未分配）。
 * 幂等：只处理 project_id IS NULL 且 dir 未登记的目录。
 */
import fs from "node:fs";
import path from "node:path";
import db from "./db.ts";
import { workspaceRoot } from "./agent/workspace.ts";
import { deriveProjectFromPath, projectDirName } from "./project.ts";

export type ProjectMigrateReport = {
  projectsCreated: Array<{ id: number; title: string; dir: string }>;
  sourcesAssigned: number;
  artifactsAssigned: number;
};

export function migrateProjects(): ProjectMigrateReport {
  const report: ProjectMigrateReport = { projectsCreated: [], sourcesAssigned: 0, artifactsAssigned: 0 };
  const root = workspaceRoot();

  // 1. 顶层目录 → 项目记录（title=目录名；已登记的跳过）
  const known = new Set((db.prepare("SELECT dir FROM projects").all() as Array<{ dir: string }>).map((r) => r.dir));
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".ifcope" || known.has(e.name)) continue;
    const info = db
      .prepare("INSERT INTO projects (title, description, dir, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)")
      .run(projectDirName(e.name, new Set()), e.name, Date.now(), Date.now());
    report.projectsCreated.push({ id: Number(info.lastInsertRowid), title: e.name, dir: e.name });
    known.add(e.name);
  }

  // 2. 文件归属派生（project_id IS NULL 的）
  const dirToId = new Map(
    (db.prepare("SELECT id, dir FROM projects").all() as Array<{ id: number; dir: string }>).map((r) => [r.dir, r.id])
  );
  const assign = (table: "sources" | "artifacts") => {
    const rows = db
      .prepare(`SELECT id, path FROM ${table} WHERE project_id IS NULL AND path IS NOT NULL`)
      .all() as Array<{ id: number; path: string }>;
    let n = 0;
    for (const r of rows) {
      const dir = deriveProjectFromPath(r.path);
      const pid = dir ? dirToId.get(dir) : undefined;
      if (pid) {
        db.prepare(`UPDATE ${table} SET project_id = ? WHERE id = ?`).run(pid, r.id);
        n++;
      }
    }
    return n;
  };
  report.sourcesAssigned = assign("sources");
  report.artifactsAssigned = assign("artifacts");

  return report;
}
