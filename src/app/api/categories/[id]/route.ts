import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 删除类目：子类目提升到祖父级；资源/产物回未归类 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const catId = Number(id);
  const cat = db.prepare("SELECT id, parent_id FROM categories WHERE id = ?").get(catId) as
    | { id: number; parent_id: number | null }
    | undefined;
  if (!cat) return NextResponse.json({ error: "类目不存在" }, { status: 404 });

  db.prepare("UPDATE sources SET category_id = NULL WHERE category_id = ?").run(catId);
  db.prepare("UPDATE artifacts SET category_id = NULL WHERE category_id = ?").run(catId);
  // 子类目提升到被删类目的父级（顶层则回顶层）
  db.prepare("UPDATE categories SET parent_id = ? WHERE parent_id = ?").run(cat.parent_id, catId);
  db.prepare("DELETE FROM categories WHERE id = ?").run(catId);
  return NextResponse.json({ ok: true });
}
