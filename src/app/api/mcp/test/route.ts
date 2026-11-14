import { NextRequest, NextResponse } from "next/server";
import { getMcpClient, type McpServerConfig } from "@/lib/mcp/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/** MCP 连接测试（harness P2 §9.3）：initialize + tools/list，返回工具数 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { server?: McpServerConfig };
  const s = body.server;
  if (!s?.name || !s.command) {
    return NextResponse.json({ ok: false, error: "缺少 server.name/command" }, { status: 400 });
  }
  try {
    const tools = await getMcpClient({ ...s, args: s.args ?? [] }).listTools();
    return NextResponse.json({
      ok: true,
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
