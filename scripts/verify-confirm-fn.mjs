// 确认底座验证（计划 P0 T2：工具分级/命令黑白名单/确认流超时）
// 运行：node scripts/verify-confirm-fn.mjs
import assert from "node:assert/strict";
const { classifyCommand, classifyTool, confirmModeAllows, askConfirmation, resolveConfirmation } = await import("../src/lib/agent/confirm.ts");

// 1. classifyCommand：白名单只读 / 写类强确认 / 黑名单硬拒
for (const c of ["ls -la", "git status", "cat a.txt"]) assert.equal(classifyCommand(c), "readonly", c);
for (const c of ["rm -rf node_modules", "git push", "npm install"]) assert.equal(classifyCommand(c), "destructive", c);
for (const c of ["RM -RF /", "rm -rf /", "format c:", "sudo x", "dd if=/dev/zero", "reg delete k", "shutdown /s", "taskkill /f", "echo hi > /dev/null"]) {
  assert.equal(classifyCommand(c), "deny", c);
}
assert.equal(classifyCommand("git add ."), "reversible");
// 绕过样本：引号包裹/大小写/&& 串联/del /f /s/重定向逃逸（spec §4.3 黑名单 + Review Focus 2）
for (const c of ['"rm -rf /"', "echo hi && RM -RF /", "del /f /s x", "DEL /F /S x", "echo x > ../evil", "echo a; rm -rf /"]) {
  assert.equal(classifyCommand(c), "deny", c);
}
// 重定向写文件不是只读
assert.equal(classifyCommand("echo x > out.txt"), "reversible");

// 2. classifyTool
assert.equal(classifyTool("read_file", {}), "readonly");
assert.equal(classifyTool("write_file", {}), "reversible");
assert.equal(classifyTool("load_skill", {}), "readonly");
assert.equal(classifyTool("run_command", { command: "rm -rf build" }), "destructive");
assert.equal(classifyTool("run_command", { command: "rm -rf /" }), "deny");

// 3. confirmModeAllows：deny 永不放行；none 全放；writes 只放 readonly；all 全确认
assert.equal(confirmModeAllows("none", "deny"), false);
assert.equal(confirmModeAllows("none", "destructive"), true);
assert.equal(confirmModeAllows("writes", "readonly"), true);
assert.equal(confirmModeAllows("writes", "reversible"), false);
assert.equal(confirmModeAllows("all", "reversible"), false);
assert.equal(confirmModeAllows("all", "readonly"), false);

// 4. 确认流：显式解除 / 超时自动拒 / 未知 callId
const p1 = askConfirmation("c1", "reversible", "write_file", {});
assert.equal(resolveConfirmation("c1", true), true);
assert.equal(await p1, true);
const p2 = askConfirmation("c2", "reversible", "write_file", {}, 50);
assert.equal(await p2, false, "超时应自动拒绝");
assert.equal(resolveConfirmation("c2", true), false, "超时后 callId 已移除");

console.log("verify-confirm-fn: OK");
