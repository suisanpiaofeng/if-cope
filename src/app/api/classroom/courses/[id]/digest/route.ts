import { NextResponse } from "next/server";
import { generateDigest, getDigestWithMeta } from "@/lib/classroom/digest";

/** 读期末手册：GET /api/classroom/courses/[id]/digest（规格 §4） */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: "无效课程 id" }, { status: 400 });
  }
  const { digest, noteCount } = getDigestWithMeta(courseId);
  return NextResponse.json({ digest: digest ?? null, noteCount });
}

/** 生成/重生成期末手册：POST */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: "无效课程 id" }, { status: 400 });
  }
  const out = await generateDigest(courseId);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 422 });
  const { digest, noteCount } = getDigestWithMeta(courseId);
  return NextResponse.json({ ok: true, digest, noteCount });
}
