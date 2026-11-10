import { NextRequest, NextResponse } from "next/server";
import { deleteCourse, getCourse } from "@/lib/classroom/store";

export const runtime = "nodejs";

/** 删课程（级联删课时） */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || !getCourse(id)) {
    return NextResponse.json({ error: "课程不存在" }, { status: 404 });
  }
  deleteCourse(id);
  return NextResponse.json({ ok: true });
}
