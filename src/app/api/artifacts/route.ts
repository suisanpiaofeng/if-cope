import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { generateNote } from "@/lib/notes";
import { isNoteKind } from "@/lib/noteKinds";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const categoryId = req.nextUrl.searchParams.get("categoryId");
  const rows = (
    categoryId && categoryId !== "all"
      ? db.prepare("SELECT * FROM artifacts WHERE category_id = ? ORDER BY created_at DESC").all(Number(categoryId))
      : db.prepare("SELECT * FROM artifacts ORDER BY created_at DESC").all()
  ) as Array<Record<string, unknown>>;
  return NextResponse.json({
    artifacts: rows.map((r) => ({ ...r, content: undefined, source_ids: JSON.parse(r.source_ids as string) })),
  });
}

export async function POST(req: NextRequest) {
  const { categoryId, sourceIds, kind } = (await req.json()) as {
    categoryId?: number | null; sourceIds: number[]; kind?: string;
  };
  // 所有产物默认落 AIGC 类目（category_id = null），用户可再拖拽分类
  const targetCategory = categoryId ?? null;
  if (targetCategory != null) {
    const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(targetCategory);
    if (!cat) return NextResponse.json({ error: "类目不存在" }, { status: 400 });
  }
  try {
    // 便签引擎：kind 决定 prompt 契约与渲染器；未知类型当复习笔记处理
    const useKind = isNoteKind(kind) ? kind : "report";
    const { title, content, model } = await generateNote(sourceIds, useKind);
    const info = db
      .prepare(
        "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(targetCategory, useKind, title, content, JSON.stringify(sourceIds), model, Date.now());
    const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(Number(info.lastInsertRowid));
    return NextResponse.json({ ...(row as object), source_ids: sourceIds });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
