import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 会话分支（harness P1 §7.2）：复制 beforeMessageId 及之前的消息到新 thread */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { threadId?: number; beforeMessageId?: number };
  const tid = Number(body.threadId);
  const mid = Number(body.beforeMessageId);
  if (!tid || !mid) return NextResponse.json({ error: "缺少 threadId/beforeMessageId" }, { status: 400 });
  const thread = db.prepare("SELECT id, title, source_ids FROM threads WHERE id = ?").get(tid) as
    | { id: number; title: string; source_ids: string }
    | undefined;
  if (!thread) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const target = db.prepare("SELECT id FROM messages WHERE id = ? AND thread_id = ?").get(mid, tid);
  if (!target) return NextResponse.json({ error: "消息不属于该会话" }, { status: 404 });

  const msgs = db
    .prepare("SELECT role, content, reasoning, citations, created_at FROM messages WHERE thread_id = ? AND id <= ? ORDER BY id")
    .all(tid, mid) as Array<{ role: string; content: string; reasoning: string | null; citations: string | null; created_at: number }>;

  const info = db
    .prepare("INSERT INTO threads (title, source_ids, created_at) VALUES (?, ?, ?)")
    .run(`${thread.title}（分支）`.slice(0, 60), thread.source_ids, Date.now());
  const newTid = Number(info.lastInsertRowid);
  const ins = db.prepare(
    "INSERT INTO messages (thread_id, role, content, reasoning, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const m of msgs) ins.run(newTid, m.role, m.content, m.reasoning, m.citations, m.created_at);
  return NextResponse.json({ ok: true, newThreadId: newTid, copied: msgs.length });
}
