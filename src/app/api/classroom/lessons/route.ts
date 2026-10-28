import { NextResponse } from "next/server";
import { listLessons, upsertLesson, getCourse } from "@/lib/classroom/store";
import type { FetchedLesson } from "@/lib/classroom/cvsApi";

/** 课时列表：GET /api/classroom/lessons?courseId=（规格 §4） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const courseId = Number(url.searchParams.get("courseId"));
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: "缺少 courseId" }, { status: 400 });
  }
  return NextResponse.json({ lessons: listLessons(courseId) });
}

/** 保存课时目录：POST /api/classroom/lessons
 *  body: { courseId, lessons: FetchedLesson[] } —— 前端经反代拉官方接口后提交到这里落库
 *  （规格 §4 分工原则：需要官方会话的请求在浏览器侧完成，服务端只管落库） */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    courseId?: number;
    lessons?: FetchedLesson[];
  };
  const courseId = Number(body.courseId);
  if (!Number.isFinite(courseId) || !getCourse(courseId)) {
    return NextResponse.json({ error: "课程不存在" }, { status: 400 });
  }
  if (!Array.isArray(body.lessons) || body.lessons.length === 0) {
    return NextResponse.json({ error: "课时列表为空" }, { status: 400 });
  }
  let saved = 0;
  for (const l of body.lessons) {
    if (!l.cvsLessonId || !l.title) continue;
    upsertLesson({
      courseId,
      cvsLessonId: l.cvsLessonId,
      title: l.title,
      seq: l.seq,
      replayUrl: l.replayUrl,
      vodStatus: l.vodStatus,
      durationSec: l.durationSec,
    });
    saved++;
  }
  return NextResponse.json({ saved });
}
