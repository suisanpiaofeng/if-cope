import { NextRequest, NextResponse } from "next/server";
import { listSkills, writeSkill, deleteSkill, isValidSkillName } from "@/lib/agent/skills";

export const runtime = "nodejs";

/** 技能管理 API（三期规格 §3.5）：GET 列表（强刷，UI 要最新文件态）/ PUT 新建更新 / DELETE 删除 */
export async function GET() {
  return NextResponse.json({ skills: listSkills(true) });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { name?: string; description?: string; body?: string; enabled?: boolean };
  const name = String(body.name ?? "").trim();
  if (!isValidSkillName(name)) {
    return NextResponse.json({ error: "非法技能名：仅允许小写字母/数字/连字符，1~40 位" }, { status: 400 });
  }
  writeSkill(name, String(body.description ?? ""), String(body.body ?? ""), body.enabled !== false);
  const skill = listSkills().find((s) => s.name === name);
  return NextResponse.json({ ok: true, skill });
}

export async function DELETE(req: NextRequest) {
  const name = String(req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!isValidSkillName(name)) {
    return NextResponse.json({ error: "非法技能名：仅允许小写字母/数字/连字符，1~40 位" }, { status: 400 });
  }
  if (!deleteSkill(name)) {
    return NextResponse.json({ error: `技能「${name}」不存在` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
