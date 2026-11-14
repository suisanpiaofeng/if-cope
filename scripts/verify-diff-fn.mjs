// 行级 diff 验证（计划 P1 T1：LCS/归一化/截断/格式化）
// 运行：node scripts/verify-diff-fn.mjs
import assert from "node:assert/strict";
const { lineDiff, formatDiff } = await import("../src/lib/agent/diff.ts");

// 1. 完全相同 → 全 same
const same = lineDiff("a\nb\nc", "a\nb\nc");
assert.ok(same.every((l) => l.type === "same"));
assert.equal(same.length, 3);

// 2. 单行修改 → 1 del + 1 add 相邻
const mod = lineDiff("a\nb\nc", "a\nB\nc");
assert.deepEqual(mod.map((l) => l.type), ["same", "del", "add", "same"]);
assert.equal(mod[1].text, "b");
assert.equal(mod[2].text, "B");
assert.equal(mod[1].oldNo, 2);
assert.equal(mod[2].newNo, 2);

// 3. 纯新增 / 纯删除
assert.deepEqual(lineDiff("a", "a\nb").map((l) => l.type), ["same", "add"]);
assert.deepEqual(lineDiff("a\nb", "a").map((l) => l.type), ["same", "del"]);

// 4. 空文本
assert.deepEqual(lineDiff("", "x").map((l) => l.type), ["del", "add"]);
assert.ok(lineDiff("", "").every((l) => l.type === "same"));

// 5. CRLF 归一化
assert.ok(lineDiff("a\r\nb", "a\nb").every((l) => l.type === "same"));

// 6. 超 5000 行截断标记
const big = Array.from({ length: 5001 }, (_, i) => `line${i}`).join("\n");
const cut = lineDiff(big, big);
assert.equal(cut.length, 5001, "5000 行 + 截断标记");
assert.ok(cut[cut.length - 1].text.includes("截断"));

// 7. formatDiff：前缀/截断
const f = formatDiff(lineDiff("a", "b"));
assert.ok(f.includes("- a") && f.includes("+ b"));
const f2 = formatDiff(lineDiff("a\nb\nc\nd", "a\nx\nc\nd"), 2);
assert.ok(f2.includes("截断"), f2);

console.log("verify-diff-fn: OK");
