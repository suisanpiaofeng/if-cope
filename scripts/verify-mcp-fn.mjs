// MCP 验证（计划 P2 T3/T4：JSON-RPC 帧解析 + 真 spawn 端到端 + 死进程自愈）
// 运行：node scripts/verify-mcp-fn.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { encodeMessage, parseMessages } = await import("../src/lib/mcp/rpc.ts");

// 1. 编码：换行分隔 JSON
assert.equal(encodeMessage({ a: 1 }), '{"a":1}\n');

// 2. 单条完整消息
const one = parseMessages('{"x":1}\n');
assert.deepEqual(one.msgs, [{ x: 1 }]);
assert.equal(one.rest, "");

// 3. 粘包：一次两条
const two = parseMessages('{"x":1}\n{"y":2}\n');
assert.equal(two.msgs.length, 2);
assert.equal(two.rest, "");

// 4. 半包：残段留 rest；补全后解析
const half = parseMessages('{"x":1}\n{"y":');
assert.equal(half.msgs.length, 1);
assert.equal(half.rest, '{"y":');
assert.deepEqual(parseMessages(half.rest + "2}\n").msgs, [{ y: 2 }]);

// 5. 坏行跳过不崩
const bad = parseMessages('not-json\n{"ok":1}\n');
assert.deepEqual(bad.msgs, [{ ok: 1 }]);

console.log("verify-mcp-fn: 帧解析 OK");

// 6. 端到端：真 spawn echo server（connect/listTools/callTool/死进程自愈）
const { getMcpClient } = await import("../src/lib/mcp/client.ts");
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-echo.mjs");
const client = getMcpClient({ name: "echo-test", command: process.execPath, args: [fixture], enabled: true });

try {
  await client.connect();
  const tools = await client.listTools();
  assert.equal(tools[0]?.name, "echo", "tools/list 应含 echo");
  const r1 = await client.callTool("echo", { text: "你好" });
  assert.equal(r1, "echo:你好", "tools/call 应回显");

  // 死进程自愈：close 后下一次调用应自动重连
  client.close();
  const r2 = await client.callTool("echo", { text: "重连" });
  assert.equal(r2, "echo:重连", "进程死后应自愈重连");
} finally {
  client.close(); // 防孤儿进程挂住事件循环
}

console.log("verify-mcp-fn: OK");
