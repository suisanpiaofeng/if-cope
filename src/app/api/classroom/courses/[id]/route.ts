import { NextResponse } from "next/server";
import { deleteCourse } from "@/lib/classroom/store";

/** 删课程（级联删课时/笔记/手册）：DELETE /api/classroom/courses/[id] */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: "无效课程 id" }, { status: 400 });
  }
  deleteCourse(courseId);
  return NextResponse.json({ ok: true });
}
