/**
 * MCP JSON-RPC 帧（harness P2 §9.3，纯函数）：
 * stdio 传输 = 换行分隔 JSON；parseMessages 处理粘包/半包，坏行跳过。
 */

export function encodeMessage(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export function parseMessages(buffer: string): { msgs: unknown[]; rest: string } {
  const msgs: unknown[] = [];
  const lines = String(buffer ?? "").split("\n");
  const rest = lines.pop() ?? ""; // 最后一段可能是半包
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      msgs.push(JSON.parse(t));
    } catch {
      /* 坏行跳过，不崩 */
    }
  }
  return { msgs, rest };
}
