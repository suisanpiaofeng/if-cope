import { NextRequest, NextResponse } from "next/server";
import { upsertCourses } from "@/lib/classroom/store";
import type { CvsCourseItem } from "@/lib/classroom/types";

export const runtime = "nodejs";

/** 同步落库（前端经反代拉好官方数据后提交；写库前结构校验，失败 400 不写半包） */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "无可同步的课程数据" }, { status: 400 });
  }
  try {
    const { inserted, updated } = upsertCourses(items as CvsCourseItem[]);
    return NextResponse.json({ ok: true, inserted, updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
