import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 会话回滚（harness P1 §7.2）：删除 fromMessageId 之后的消息（checkpoint 回滚；不可逆由 UI 强确认把关） */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { threadId?: number; fromMessageId?: number };
  const tid = Number(body.threadId);
  const mid = Number(body.fromMessageId);
  if (!tid || !mid) return NextResponse.json({ error: "缺少 threadId/fromMessageId" }, { status: 400 });
  const target = db.prepare("SELECT id FROM messages WHERE id = ? AND thread_id = ?").get(mid, tid);
  if (!target) return NextResponse.json({ error: "消息不属于该会话" }, { status: 404 });
  const r = db.prepare("DELETE FROM messages WHERE thread_id = ? AND id > ?").run(tid, mid);
  return NextResponse.json({ ok: true, deleted: r.changes });
}
