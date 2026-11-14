import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import db from "@/lib/db";
import { sha256 } from "@/lib/storage";
import { sourcePath } from "@/lib/fileTree";
import { ingestSource } from "@/lib/ingest";
import { isEditableExt } from "@/lib/preview";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const src = db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as
    | { filename: string; path: string | null; source_type: string }
    | undefined;
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (src.source_type === "file") fs.rmSync(sourcePath(src), { force: true });
  db.prepare("DELETE FROM chunks WHERE source_id = ?").run(id);
  db.prepare("DELETE FROM sources WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

/** 编辑保存：写回原始文件 → 更新 sha256/size → 重建分块与向量索引 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const src = db.prepare("SELECT filename, path, ext, source_type FROM sources WHERE id = ?").get(id) as
    | { filename: string; path: string | null; ext: string; source_type: string }
    | undefined;
  if (!src || src.source_type !== "file") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!isEditableExt(src.ext)) {
    return NextResponse.json({ error: `.${src.ext} 不支持编辑` }, { status: 415 });
  }

  const body = (await req.json()) as { text?: string };
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "缺少 text 字段" }, { status: 400 });
  }

  const buffer = Buffer.from(body.text, "utf-8");
  fs.writeFileSync(sourcePath(src), buffer);
  db.prepare("UPDATE sources SET sha256 = ?, size = ? WHERE id = ?").run(
    sha256(buffer), buffer.length, id
  );

  // 内容变了，旧分块/向量已失效：删除后走既有管线重建
  db.prepare("DELETE FROM chunks WHERE source_id = ?").run(id);
  db.prepare("UPDATE sources SET status = 'processing', note = NULL WHERE id = ?").run(id);
  await ingestSource(id);

  const after = db.prepare("SELECT status, note, chunk_count FROM sources WHERE id = ?").get(id) as
    { status: string; note: string | null; chunk_count: number };
  return NextResponse.json({ ok: true, ...after });
}

/** 移动资源到类目：PATCH { categoryId: number | null } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const body = (await req.json()) as { categoryId?: number | null };
  const src = db.prepare("SELECT id FROM sources WHERE id = ?").get(id);
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  const categoryId = body.categoryId ?? null;
  if (categoryId != null) {
    const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId);
    if (!cat) return NextResponse.json({ error: "类目不存在" }, { status: 400 });
  }
  db.prepare("UPDATE sources SET category_id = ? WHERE id = ?").run(categoryId, id);
  return NextResponse.json({ ok: true });
}

/** 重新解析（失败修复或配置模型后补解析图片/音频类） */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const src = db.prepare("SELECT id FROM sources WHERE id = ?").get(id);
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  db.prepare("DELETE FROM chunks WHERE source_id = ?").run(id);
  db.prepare("UPDATE sources SET status = 'processing', note = NULL WHERE id = ?").run(id);
  await ingestSource(id);
  const updated = db
    .prepare("SELECT status, note, page_count, chunk_count FROM sources WHERE id = ?")
    .get(id);
  return NextResponse.json(updated);
}
