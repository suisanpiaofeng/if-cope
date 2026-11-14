// hooks 验证（计划 P2 T5：配置解析容错/glob 匹配/黑名单过滤）
// 运行：node scripts/verify-hook-fn.mjs
import assert from "node:assert/strict";
const { parseHooksConfig, matchHooks, filterSafeHooks } = await import("../src/lib/agent/hooks.ts");

// 1. 解析容错：正常/坏 json/缺 command 条目
const cfg = parseHooksConfig(
  JSON.stringify({
    pre: [{ command: "node a.js" }, { command: "node b.js", match: "write_*" }],
    post: [{ command: "node c.js" }],
  })
);
assert.equal(cfg.pre.length, 2);
assert.equal(cfg.post.length, 1);
assert.deepEqual(parseHooksConfig("not-json").pre, []);
assert.equal(parseHooksConfig(JSON.stringify({ pre: [{ nope: 1 }] })).pre.length, 0, "缺 command 的条目丢弃");

// 2. glob 匹配：* / 前缀* / 精确
const list = [
  { command: "x", match: "*" },
  { command: "y", match: "write_*" },
  { command: "z", match: "read_file" },
];
assert.equal(matchHooks(list, "run_command").length, 1);
assert.equal(matchHooks(list, "write_file").length, 2);
assert.equal(matchHooks(list, "read_file").length, 2);
assert.equal(matchHooks(list, "edit_file").length, 1);

// 3. 黑名单过滤：危险命令的 hook 不跑
const safe = filterSafeHooks([{ command: "rm -rf /" }, { command: "node ok.js" }]);
assert.equal(safe.length, 1);
assert.equal(safe[0].command, "node ok.js");

console.log("verify-hook-fn: OK");
