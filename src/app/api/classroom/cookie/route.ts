import { NextResponse } from "next/server";
import db from "@/lib/db";

const KEY = "classroom.proxyCookie";

/** 手动 Cookie 兜底（规格 §8：网页登录链路失败时的保底路径）。GET 只回是否有，不回显内容。 */
export async function GET() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as
    | { value: string }
    | undefined;
  return NextResponse.json({ has: Boolean(row?.value) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cookie?: string };
  const cookie = (body.cookie ?? "").trim();
  if (!cookie) return NextResponse.json({ error: "Cookie 为空" }, { status: 400 });
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(KEY, cookie);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
  return NextResponse.json({ ok: true });
}
