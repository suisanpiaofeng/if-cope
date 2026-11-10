import { NextRequest, NextResponse } from "next/server";
import { getCourse, listLessons } from "@/lib/classroom/store";

export const runtime = "nodejs";

/** 该课程课时列表（本地缓存；课程不存在 404） */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || !getCourse(id)) {
    return NextResponse.json({ error: "课程不存在" }, { status: 404 });
  }
  return NextResponse.json({ lessons: listLessons(id) });
}
