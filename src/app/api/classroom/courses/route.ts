import { NextRequest, NextResponse } from "next/server";
import { listCourses } from "@/lib/classroom/store";

export const runtime = "nodejs";

/** 本地课程列表（q 过滤 课程名/教学班/编号/学期） */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  return NextResponse.json({ courses: listCourses(q) });
}
