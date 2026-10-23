import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 引用跳转的数据源：按资源+页码取原文块 */
export async function GET(req: NextRequest) {
  const sourceId = Number(req.nextUrl.searchParams.get("sourceId"));
  const pageParam = req.nextUrl.searchParams.get("page");
  const page = pageParam === "null" || pageParam == null ? null : Number(pageParam);
  if (!sourceId) return NextResponse.json({ error: "缺少 sourceId" }, { status: 400 });

  const rows = (
    page == null
      ? db.prepare("SELECT page, text FROM chunks WHERE source_id = ? ORDER BY idx").all(sourceId)
      : db.prepare("SELECT page, text FROM chunks WHERE source_id = ? AND page = ? ORDER BY idx").all(sourceId, page)
  ) as Array<{ page: number | null; text: string }>;

  const src = db.prepare("SELECT title FROM sources WHERE id = ?").get(sourceId) as
    | { title: string }
    | undefined;
  return NextResponse.json({ title: src?.title ?? "", chunks: rows });
}
