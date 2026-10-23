import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(Number(id)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  row.source_ids = JSON.parse(row.source_ids as string);
  return NextResponse.json(row);
}

/** 移动成果到类目：PATCH { categoryId: number | null }（null = AIGC） */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const body = (await req.json()) as { categoryId?: number | null };
  const row = db.prepare("SELECT id FROM artifacts WHERE id = ?").get(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const categoryId = body.categoryId ?? null;
  if (categoryId != null) {
    const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId);
    if (!cat) return NextResponse.json({ error: "类目不存在" }, { status: 400 });
  }
  db.prepare("UPDATE artifacts SET category_id = ? WHERE id = ?").run(categoryId, id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db.prepare("DELETE FROM artifacts WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
