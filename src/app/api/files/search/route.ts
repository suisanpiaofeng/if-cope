import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { retrieve } from "@/lib/retrieval";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 语义搜索（harness P3-3 §4.5 双搜索的"问答结果"侧）：按问题找资料片段 */
export async function GET(req: NextRequest) {
  const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [] });
  try {
    // 全库语义检索：范围 = 全部已入库资料（retrieve 按 sourceIds 圈定）
    const ids = (db.prepare("SELECT DISTINCT source_id FROM chunks").all() as Array<{ source_id: number }>).map(
      (r) => r.source_id
    );
    const hits = await retrieve(q, ids);
    return NextResponse.json({
      hits: hits.slice(0, 5).map((h) => ({
        sourceId: h.sourceId,
        title: h.title,
        page: h.page,
        quote: h.quote,
      })),
    });
  } catch {
    return NextResponse.json({ hits: [] });
  }
}
