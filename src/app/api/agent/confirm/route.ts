import { NextRequest, NextResponse } from "next/server";
import { resolveConfirmation } from "@/lib/agent/confirm";

export const runtime = "nodejs";

/** 确认回调（harness P0 §4.2）：前端确认卡点击 → 解除挂起的工具调用 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { callId?: string; approve?: boolean };
  const callId = String(body.callId ?? "").trim();
  if (!callId) return NextResponse.json({ error: "缺少 callId" }, { status: 400 });
  const found = resolveConfirmation(callId, Boolean(body.approve));
  return NextResponse.json({ ok: true, found });
}
