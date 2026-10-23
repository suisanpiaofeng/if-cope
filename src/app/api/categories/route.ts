import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM sources s WHERE s.category_id = c.id) AS source_count
       FROM categories c ORDER BY c.pinned DESC, c.parent_id IS NOT NULL, c.parent_id, c.id`
    )
    .all();
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const { name, parentId } = (await req.json()) as { name?: string; parentId?: number | null };
  if (!name?.trim()) return NextResponse.json({ error: "请填写类目名" }, { status: 400 });
  let parent: number | null = null;
  if (parentId != null) {
    const p = db.prepare("SELECT id FROM categories WHERE id = ?").get(parentId);
    if (!p) return NextResponse.json({ error: "父类目不存在" }, { status: 400 });
    parent = Number(parentId);
  }
  const info = db
    .prepare("INSERT INTO categories (name, parent_id, created_at) VALUES (?, ?, ?)")
    .run(name.trim(), parent, Date.now());
  return NextResponse.json({ id: Number(info.lastInsertRowid), name: name.trim(), parentId: parent });
}
