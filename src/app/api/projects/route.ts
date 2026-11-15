import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import db from "@/lib/db";
import { workspaceRoot } from "@/lib/agent/workspace";
import { projectDirName } from "@/lib/project";

export const runtime = "nodejs";
export const maxDuration = 60;

type ProjectRow = { id: number; title: string; description: string | null; dir: string; created_at: number; updated_at: number };

function stats(dir: string): { sourceCount: number; artifactCount: number } {
  const like = `${dir}/%`;
  const s = (db.prepare("SELECT COUNT(*) AS n FROM sources WHERE path LIKE ?").get(like) as { n: number }).n;
  const a = (db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE path LIKE ?").get(like) as { n: number }).n;
  return { sourceCount: s, artifactCount: a };
}

export async function GET() {
  const rows = db.prepare("SELECT * FROM projects ORDER BY id DESC").all() as ProjectRow[];
  return NextResponse.json({
    projects: rows.map((r) => ({ ...r, ...stats(r.dir) })),
  });
}

/** 新建项目（自由工作空间：只填名称/描述；项目=顶层目录，目录名创建时定格） */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { title?: string; description?: string };
  const title = String(body.title ?? "").trim().slice(0, 60);
  if (!title) return NextResponse.json({ error: "请填写项目名称" }, { status: 400 });
  const taken = new Set(
    (db.prepare("SELECT dir FROM projects").all() as Array<{ dir: string }>).map((r) => r.dir)
  );
  for (const e of fs.readdirSync(workspaceRoot(), { withFileTypes: true })) {
    if (e.isDirectory()) taken.add(e.name);
  }
  const dir = projectDirName(title, taken);
  fs.mkdirSync(path.join(workspaceRoot(), dir), { recursive: true });
  const info = db
    .prepare("INSERT INTO projects (title, description, dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(title, String(body.description ?? "").trim().slice(0, 300) || null, dir, Date.now(), Date.now());
  return NextResponse.json({ ok: true, project: { id: Number(info.lastInsertRowid), title, dir } });
}

/** 改标题/描述（不动目录——标题与目录解耦） */
export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { id?: number; title?: string; description?: string };
  const id = Number(body.id);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!row) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 60) : row.title;
  const description =
    body.description !== undefined ? String(body.description).trim().slice(0, 300) || null : row.description;
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  db.prepare("UPDATE projects SET title = ?, description = ?, updated_at = ? WHERE id = ?").run(
    title, description, Date.now(), id
  );
  return NextResponse.json({ ok: true });
}

/** 删除项目（destructive）：删目录（文件）＋清资料/产物记录（chunks 随）；会话历史保留（归属后置处理） */
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!row) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const like = `${row.dir}/%`;
  // 先清索引/记录（文件随后随目录删）
  for (const s of db.prepare("SELECT id FROM sources WHERE path LIKE ?").all(like) as Array<{ id: number }>) {
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(s.id);
  }
  db.prepare("DELETE FROM sources WHERE path LIKE ?").run(like);
  db.prepare("DELETE FROM artifacts WHERE path LIKE ?").run(like);
  fs.rmSync(path.join(workspaceRoot(), row.dir), { recursive: true, force: true });
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
