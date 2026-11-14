#!/usr/bin/env node
/**
 * 最小 MCP stdio server（测试资产，P2 T4）：
 * newline-delimited JSON-RPC 2.0；提供 echo 工具（tools/call 回显 text）。
 */
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
  if (msg.method === "initialize") {
    reply({ protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mcp-echo", version: "1.0" } });
  } else if (msg.method === "notifications/initialized") {
    // 通知无需响应
  } else if (msg.method === "tools/list") {
    reply({
      tools: [
        {
          name: "echo",
          description: "回显文本（测试用）",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        },
      ],
    });
  } else if (msg.method === "tools/call") {
    const text = String(msg.params?.arguments?.text ?? "");
    reply({ content: [{ type: "text", text: `echo:${text}` }] });
  } else if (msg.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `未知方法 ${msg.method}` } }) + "\n");
  }
});
