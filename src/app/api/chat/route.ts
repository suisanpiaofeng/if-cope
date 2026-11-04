import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { retrieve, buildContextBlocks, Retrieved } from "@/lib/retrieval";
import { streamChat, ChatMessage } from "@/lib/llm";
import { webSearch, webHitsToContext, type WebHit } from "@/lib/webSearch";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const threadId = Number(req.nextUrl.searchParams.get("threadId"));
  if (!threadId) {
    const threads = db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
         FROM threads t ORDER BY t.created_at DESC`
      )
      .all();
    return NextResponse.json({ threads });
  }
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId);
  const messages = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY id")
    .all(threadId);
  return NextResponse.json({ thread, messages });
}

export async function DELETE(req: NextRequest) {
  const threadId = Number(req.nextUrl.searchParams.get("threadId"));
  if (!threadId) return NextResponse.json({ error: "缺少 threadId" }, { status: 400 });
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { threadId, sourceIds, question } = (await req.json()) as {
    threadId?: number; sourceIds: number[]; question: string;
  };
  if (!question?.trim()) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  if (!sourceIds?.length) {
    return NextResponse.json({ error: "请先勾选要问答的资源" }, { status: 400 });
  }

  // 线程：没有就建，标题取首问
  let tid = threadId;
  if (!tid) {
    const info = db
      .prepare("INSERT INTO threads (title, source_ids, created_at) VALUES (?, ?, ?)")
      .run(question.trim().slice(0, 40), JSON.stringify(sourceIds), Date.now());
    tid = Number(info.lastInsertRowid);
  } else {
    db.prepare("UPDATE threads SET source_ids = ? WHERE id = ?").run(JSON.stringify(sourceIds), tid);
  }

  const history = (
    db.prepare("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id").all(tid) as {
      role: string; content: string;
    }[]
  ).map((m) => ({ role: m.role as ChatMessage["role"], content: m.content }));

  db.prepare("INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
    .run(tid, question.trim(), Date.now());

  const hits = await retrieve(question, sourceIds);
  const contextBlocks = buildContextBlocks(hits);

  // ── 联网搜索（确定性预搜，不依赖模型主动调工具）：问题带时效性或资料库无命中时
  //    服务端直接搜并注入上下文（与解题页 /api/ask 同策略；web_search 工具仍保留给追问链路）
  const looksFresh = /新闻|最新|今天|今日|现在|目前|当前|最近|近年|20\d{2}|发生了什么|谁是现任|进展|热点|实时|汇率|股价|排名/.test(question);
  const webHits: WebHit[] = question && (looksFresh || hits.length === 0) ? await webSearch(question) : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        send({ threadId: tid, citations: hits });
        if (webHits.length) {
          // 活动面板里展示「联网搜索」结果数（与工具活动同 UI）
          send({ tool: { name: "web_search", phase: "done", detail: `已联网检索 ${webHits.length} 条参考` } });
        }
        let full = "";
        const finalBlocks = webHits.length ? [...contextBlocks, webHitsToContext(webHits)] : contextBlocks;
        for await (const part of streamChat(question.trim(), finalBlocks, history, sourceIds)) {
          if (part.tool) {
            send({ tool: part.tool });
          }
          if (part.delta) {
            full += part.delta;
            send({ delta: part.delta });
          }
        }
        db.prepare(
          "INSERT INTO messages (thread_id, role, content, citations, created_at) VALUES (?, 'assistant', ?, ?, ?)"
        ).run(tid, full, JSON.stringify(hits), Date.now());
        send({ done: true });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
