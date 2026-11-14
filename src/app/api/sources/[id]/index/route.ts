import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { ingestSource } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 问答索引开关（harness P3-1 §2.2）：on=入库（解析建块）/ off=出库（删块，文件不动） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const body = (await req.json()) as { on?: boolean };
  const src = db.prepare("SELECT id, status, source_type FROM sources WHERE id = ?").get(id) as
    | { id: number; status: string; source_type: string }
    | undefined;
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (src.source_type === "link") return NextResponse.json({ error: "链接类资料始终可问答，无需开关" }, { status: 400 });

  if (body.on === false) {
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(id);
    db.prepare("UPDATE sources SET status = 'skipped', chunk_count = 0 WHERE id = ?").run(id);
    return NextResponse.json({ ok: true, indexed: false });
  }
  // 入库：已有块则幂等返回；无块走既有解析管线
  const n = (db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE source_id = ?").get(id) as { n: number }).n;
  if (n === 0) {
    db.prepare("UPDATE sources SET status = 'processing', note = NULL WHERE id = ?").run(id);
    await ingestSource(id);
  }
  const after = db.prepare("SELECT status, chunk_count FROM sources WHERE id = ?").get(id);
  return NextResponse.json({ ok: true, indexed: true, ...(after as object) });
}
