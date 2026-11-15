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
        `SELECT t.*, p.title AS project_title, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
         FROM threads t LEFT JOIN projects p ON p.id = t.project_id
         ORDER BY t.created_at DESC`
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

/** 会话重命名（harness P0 §5） */
export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { threadId?: number; title?: string };
  const tid = Number(body.threadId);
  const title = String(body.title ?? "").trim().slice(0, 60);
  if (!tid) return NextResponse.json({ error: "缺少 threadId" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  const r = db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, tid);
  if (!r.changes) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const threadId = Number(req.nextUrl.searchParams.get("threadId"));
  if (!threadId) return NextResponse.json({ error: "缺少 threadId" }, { status: 400 });
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  return NextResponse.json({ ok: true });
}

/** 产物 → 上下文块（知识地图转问答卡摘要；其他产物整篇截断）。
 *  不用 [n] 编号——引用规则只覆盖资料片段，产物以【产物】标识供模型区分。 */
function buildArtifactBlocks(ids: number[]): string[] {
  if (!ids.length) return [];
  const rows = db
    .prepare(`SELECT title, type, content FROM artifacts WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Array<{ title: string; type: string; content: string | null }>;
  return rows.map((a) => {
    const body = a.content ?? "";
    if (a.type === "qa-map") {
      try {
        const data = JSON.parse(body) as { nodes?: Array<{ title?: string; question?: string; answer?: string }> };
        const cards = (data.nodes ?? [])
          .map((n) => `【卡片】${n.title ?? ""}\n问题：${n.question ?? ""}\n回答：${String(n.answer ?? "").slice(0, 600)}`)
          .join("\n\n");
        return `【产物·知识地图】《${a.title}》（共 ${(data.nodes ?? []).length} 张问答卡）\n${cards}`;
      } catch {
        return `【产物】《${a.title}》（内容损坏，无法解析）`;
      }
    }
    return `【产物】《${a.title}》\n${body.slice(0, 8000)}`;
  });
}

export async function POST(req: NextRequest) {
  const { threadId, sourceIds, question, artifactIds, projectId } = (await req.json()) as {
    threadId?: number; sourceIds: number[]; question: string; artifactIds?: number[]; projectId?: number | null;
  };
  if (!question?.trim()) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  if (!sourceIds?.length && !artifactIds?.length && !projectId) {
    return NextResponse.json({ error: "请先勾选要问答的资源或产物" }, { status: 400 });
  }

  // 项目锚定（P4-4）：无手选依据时默认检索当前项目内已入库资料
  let scopedIds = sourceIds;
  if (!scopedIds.length && projectId) {
    scopedIds = (
      db.prepare("SELECT id FROM sources WHERE project_id = ? AND status = 'ready'").all(projectId) as Array<{ id: number }>
    ).map((r) => r.id);
  }
  const projectTitle = projectId
    ? (db.prepare("SELECT title FROM projects WHERE id = ?").get(projectId) as { title: string } | undefined)?.title
    : undefined;

  // 线程：没有就建，标题取首问；归属创建时项目（不可改，P4 定稿 §〇）
  let tid = threadId;
  if (!tid) {
    const info = db
      .prepare("INSERT INTO threads (title, source_ids, project_id, created_at) VALUES (?, ?, ?, ?)")
      .run(question.trim().slice(0, 40), JSON.stringify(sourceIds), projectId ?? null, Date.now());
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

  const hits = await retrieve(question, scopedIds);
  const contextBlocks = buildContextBlocks(hits);
  // ── 产物上下文（勾选的知识地图/笔记等）：产物不分块，整篇注入（截断） ──
  const artifactBlocks = buildArtifactBlocks(artifactIds ?? []);

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
          send({ tool: { name: "web_search", phase: "done", detail: `已联网检索 ${webHits.length} 条参考`, round: 0 } });
        }
        let full = "";
        let reasoningFull = "";
        const finalBlocks = [...contextBlocks, ...artifactBlocks, ...(webHits.length ? [webHitsToContext(webHits)] : [])];
        for await (const part of streamChat(question.trim(), finalBlocks, history, scopedIds, tid, projectTitle)) {
          if (part.reasoning) {
            reasoningFull += part.reasoning;
            send({ reasoning: part.reasoning });
          }
          if (part.tool) {
            send({ tool: part.tool });
          }
          if (part.confirm) {
            send({ confirm: part.confirm });
          }
          if (part.plan) {
            send({ plan: part.plan });
          }
          if (part.run) {
            send({ run: part.run });
          }
          if (part.delta) {
            full += part.delta;
            send({ delta: part.delta });
          }
        }
        db.prepare(
          "INSERT INTO messages (thread_id, role, content, reasoning, citations, created_at) VALUES (?, 'assistant', ?, ?, ?, ?)"
        ).run(tid, full, reasoningFull || null, JSON.stringify(hits), Date.now());
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
