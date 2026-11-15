import { NextResponse } from "next/server";
import { migrateProjects } from "@/lib/projectMigrate";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 触发项目迁移（幂等；顶层目录升级为项目＋归属派生） */
export async function POST() {
  const report = migrateProjects();
  return NextResponse.json({ ok: true, ...report });
}
