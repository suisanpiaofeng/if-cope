import { NextRequest, NextResponse } from "next/server";
import { listPrefs, deletePref } from "@/lib/agent/prefs";

export const runtime = "nodejs";

/** 偏好列表：GET /api/prefs */
export async function GET() {
  return NextResponse.json({ prefs: listPrefs() });
}

/** 删除一条：DELETE /api/prefs?id=<n> */
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id 必填且为整数" }, { status: 400 });
  }
  if (!deletePref(id)) {
    return NextResponse.json({ error: `偏好 #${id} 不存在` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
