import { NextResponse } from "next/server";
import { migrateUploadsToTree } from "@/lib/fileMigrate";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 触发散列存储 → 统一文件树迁移（幂等；POST 即跑） */
export async function POST() {
  const report = migrateUploadsToTree();
  return NextResponse.json({ ok: true, ...report });
}
