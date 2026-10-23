import { NextRequest, NextResponse } from "next/server";
import db, { getAigcCategoryId } from "@/lib/db";

export const runtime = "nodejs";

/** 删除类目：固定类目（AIGC）不可删；子类目提升到祖父级；资源回未归类；产物回 AIGC */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const catId = Number(id);
  const cat = db.prepare("SELECT id, pinned, parent_id FROM categories WHERE id = ?").get(catId) as
    | { id: number; pinned: number; parent_id: number | null }
    | undefined;
  if (!cat) return NextResponse.json({ error: "类目不存在" }, { status: 404 });
  if (cat.pinned === 1) return NextResponse.json({ error: "AIGC 是固定类目，不可删除" }, { status: 400 });

  const aigcId = getAigcCategoryId();
  db.prepare("UPDATE sources SET category_id = NULL WHERE category_id = ?").run(catId);
  if (aigcId != null) {
    db.prepare("UPDATE artifacts SET category_id = ? WHERE category_id = ?").run(aigcId, catId);
  }
  // 子类目提升到被删类目的父级（顶层则回顶层）
  db.prepare("UPDATE categories SET parent_id = ? WHERE parent_id = ?").run(cat.parent_id, catId);
  db.prepare("DELETE FROM categories WHERE id = ?").run(catId);
  return NextResponse.json({ ok: true });
}
