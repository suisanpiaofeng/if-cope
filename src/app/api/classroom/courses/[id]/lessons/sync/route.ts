import { NextRequest, NextResponse } from "next/server";
import { getCourse, replaceLessons } from "@/lib/classroom/store";
import type { CvsLessonItem } from "@/lib/classroom/types";

export const runtime = "nodejs";

/** 课时同步落库（整体替换语义：先删该课全部课时再插；结构不符整体拒绝 400） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || !getCourse(id)) {
    return NextResponse.json({ error: "课程不存在" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const items = body?.items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "课时数据结构变化：items 不是数组" }, { status: 400 });
  }
  try {
    const { inserted } = replaceLessons(id, items as CvsLessonItem[]);
    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
