import { NextRequest, NextResponse } from "next/server";
import { getTodos, replaceTodos, type TodoItem } from "@/lib/agent/todo";

export const runtime = "nodejs";

function parseThreadId(v: string | null): number | null {
  const n = Number(v);
  return v != null && Number.isInteger(n) ? n : null;
}

/** 读某会话任务清单：GET /api/agent/todos?threadId=<n> */
export async function GET(req: NextRequest) {
  const threadId = parseThreadId(req.nextUrl.searchParams.get("threadId"));
  if (threadId === null) {
    return NextResponse.json({ error: "threadId 必填且为整数" }, { status: 400 });
  }
  return NextResponse.json({ todos: getTodos(threadId) });
}

/** 整体覆盖写入：PUT { threadId: number, todos: TodoItem[] } */
export async function PUT(req: NextRequest) {
  let body: { threadId?: unknown; todos?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "number" && Number.isInteger(body.threadId) ? body.threadId : null;
  if (threadId === null) {
    return NextResponse.json({ error: "threadId 必填且为整数" }, { status: 400 });
  }
  if (!Array.isArray(body.todos)) {
    return NextResponse.json({ error: "todos 必须是数组" }, { status: 400 });
  }
  replaceTodos(threadId, body.todos as TodoItem[]);
  return NextResponse.json({ ok: true });
}
