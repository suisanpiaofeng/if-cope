import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 删除类目：资源移回未归类，不删文件 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db.prepare("UPDATE sources SET category_id = NULL WHERE category_id = ?").run(Number(id));
  db.prepare("DELETE FROM categories WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
