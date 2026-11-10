import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

/** 用量聚合：GET /api/usage/summary?days=7|30|all（缺省 all）
 *  消费 usage_ledger（recordUsage 一直在写），按 action/model 聚合。 */
export async function GET(req: NextRequest) {
  const days = req.nextUrl.searchParams.get("days") ?? "all";
  const cutoff =
    days === "all" ? null : Date.now() - (days === "7" ? 7 : days === "30" ? 30 : Number.NaN) * 86400_000;
  if (days !== "all" && cutoff !== null && !Number.isFinite(cutoff)) {
    return NextResponse.json({ error: "days 必须是 7/30/all" }, { status: 400 });
  }
  const where = cutoff == null ? "" : "WHERE created_at >= ?";
  const params = cutoff == null ? [] : [cutoff];
  const rows = db
    .prepare(
      `SELECT action, model, COUNT(*) AS count,
              SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens
       FROM usage_ledger ${where} GROUP BY action, model ORDER BY action, model`
    )
    .all(...params) as Array<{
    action: string;
    model: string;
    count: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  const total = rows.reduce(
    (t, r) => ({
      count: t.count + r.count,
      prompt_tokens: t.prompt_tokens + (r.prompt_tokens ?? 0),
      completion_tokens: t.completion_tokens + (r.completion_tokens ?? 0),
    }),
    { count: 0, prompt_tokens: 0, completion_tokens: 0 }
  );
  return NextResponse.json({ rows, total });
}
