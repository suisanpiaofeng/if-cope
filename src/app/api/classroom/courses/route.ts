import { NextResponse } from "next/server";
import { upsertCourse, listCourses } from "@/lib/classroom/store";
import { parseTeclId } from "@/lib/classroom/cvsApi";

/** 课程列表：GET /api/classroom/courses（规格 §4） */
export async function GET() {
  return NextResponse.json({ courses: listCourses() });
}

/** 登记课程：POST /api/classroom/courses（body: { url, name?, term? }；服务端解析 teclId） */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    name?: string;
    term?: string;
  };
  const teclId = body.url ? parseTeclId(body.url) : null;
  if (!teclId) {
    return NextResponse.json(
      {
        error:
          "链接里没找到明文 teclId（暂只支持明文链接；可先在官方页打开课程，复制地址栏链接）",
      },
      { status: 400 }
    );
  }
  const name = (body.name ?? "").trim() || `课程 ${teclId}`;
  const id = upsertCourse({ cvsCourseId: teclId, name, term: body.term?.trim() });
  return NextResponse.json({ id });
}
