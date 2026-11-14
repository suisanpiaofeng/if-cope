// 错误分类验证（计划 P1 T2：classifyError/friendlyError/stripAnsi）
// 运行：node scripts/verify-error-fn.mjs
import assert from "node:assert/strict";
const { classifyError, friendlyError, stripAnsi } = await import("../src/lib/agent/errors.ts");

// 1. 分类：网络
for (const m of ["fetch failed", "ECONNREFUSED", "ENOTFOUND api.example.com", "socket hang up", "网络错误"]) {
  assert.equal(classifyError(m), "network", m);
}
// 2. 分类：超时
for (const m of ["工具 read_file 超时", "operation timed out", "ETIMEDOUT", "命令超时（30000ms）已终止"]) {
  assert.equal(classifyError(m), "timeout", m);
}
// 3. 分类：校验
for (const m of ["路径超出工作区：../x", "技能名不能为空", "name 非法", "文件不存在：a.md", "id 必须是整数", "目标是目录"]) {
  assert.equal(classifyError(m), "validation", m);
}
// 4. 分类：拒绝
for (const m of ["命令被安全策略拒绝", "学生未确认或拒绝了本次操作", "技能「x」已禁用", "工具执行被安全策略拒绝（危险操作）"]) {
  assert.equal(classifyError(m), "denied", m);
}
// 5. 兜底
assert.equal(classifyError("莫名其妙的错"), "unknown");

// 6. friendlyError：保留原信息 + 分类标签 + 建议
for (const [kind, hint] of [["network", "网络"], ["timeout", "缩小范围"], ["validation", "修正"], ["denied", "学生"], ["unknown", "重试"]]) {
  const f = friendlyError(kind, "原始信息X");
  assert.ok(f.includes("原始信息X") && f.includes(hint), `${kind}: ${f}`);
}

// 7. stripAnsi
assert.equal(stripAnsi("\x1b[31m红\x1b[0m字"), "红字");
assert.equal(stripAnsi("普通文本"), "普通文本");

console.log("verify-error-fn: OK");
