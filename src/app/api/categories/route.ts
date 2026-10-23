import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM sources s WHERE s.category_id = c.id) AS source_count
       FROM categories c ORDER BY c.id`
    )
    .all();
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "请填写课程名" }, { status: 400 });
  const info = db
    .prepare("INSERT INTO categories (name, created_at) VALUES (?, ?)")
    .run(name.trim(), Date.now());
  return NextResponse.json({ id: Number(info.lastInsertRowid), name: name.trim() });
}
