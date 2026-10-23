import { NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = db
    .prepare("SELECT action, model, prompt_tokens, completion_tokens, created_at FROM usage_ledger ORDER BY id DESC LIMIT 100")
    .all();
  const totals = db
    .prepare(
      `SELECT action, COUNT(*) AS calls,
              SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens
       FROM usage_ledger GROUP BY action`
    )
    .all();
  return NextResponse.json({ rows, totals });
}
