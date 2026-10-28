import { NextResponse } from "next/server";
import { generateLessonNote } from "@/lib/classroom/notes";
import { getLessonNote } from "@/lib/classroom/store";
import type { TranscriptSegment } from "@/lib/classroom/types";

/** 读逐课笔记：GET /api/classroom/lessons/[id]/note（规格 §4） */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lessonId = Number(id);
  if (!Number.isFinite(lessonId)) {
    return NextResponse.json({ error: "无效课时 id" }, { status: 400 });
  }
  const note = getLessonNote(lessonId);
  if (!note) return NextResponse.json({ error: "暂无笔记" }, { status: 404 });
  return NextResponse.json({ note });
}

/** 生成逐课笔记：POST（body: { segments? | manualText? }——字幕由前端经反代现拉后提交） */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lessonId = Number(id);
  if (!Number.isFinite(lessonId)) {
    return NextResponse.json({ error: "无效课时 id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    segments?: TranscriptSegment[];
    manualText?: string;
  };
  const out = await generateLessonNote(lessonId, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
