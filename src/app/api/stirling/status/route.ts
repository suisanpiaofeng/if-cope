import { NextResponse } from "next/server";
import { isStirlingReady, isStirlingRunning, startStirling, waitStirlingReady } from "@/lib/stirling";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Stirling 状态探测：未启动则拉起并等待就绪（首访 10~30s） */
export async function GET() {
  if (isStirlingReady()) return NextResponse.json({ status: "ready" });
  if (isStirlingRunning()) {
    const ok = await waitStirlingReady(15_000);
    return NextResponse.json({ status: ok ? "ready" : "starting" });
  }
  startStirling();
  const ok = await waitStirlingReady(25_000);
  return NextResponse.json({ status: ok ? "ready" : ok === false && !isStirlingRunning() ? "missing" : "starting" });
}
