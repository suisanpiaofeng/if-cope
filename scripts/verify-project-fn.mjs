// 项目数据层验证（计划 P4-1 T1：项目=目录命名/归属派生）
// 运行：node scripts/verify-project-fn.mjs
import assert from "node:assert/strict";
const { projectDirName, deriveProjectFromPath } = await import("../src/lib/project.ts");

// 1. 项目目录名：清洗非法字符/去首尾点空格/截 40
assert.equal(projectDirName("高数", new Set()), "高数");
assert.equal(projectDirName("做 PPT/海报", new Set()), "做 PPT_海报");
assert.equal(projectDirName("  期末冲刺...  ", new Set()), "期末冲刺");
assert.equal(projectDirName("x".repeat(80), new Set()).length, 40);
assert.equal(projectDirName("", new Set()), "未命名项目");

// 2. 去重（大小写不敏感 -2/-3）
assert.equal(projectDirName("高数", new Set(["高数"])), "高数-2");
assert.equal(projectDirName("高数", new Set(["高数", "高数-2"])), "高数-3");
assert.equal(projectDirName("Same", new Set(["same"])), "Same-2");

// 3. 归属派生：顶层目录段；根平铺文件 → null
assert.equal(deriveProjectFromPath("高数/讲义/x.pdf"), "高数");
assert.equal(deriveProjectFromPath("高数/讲义"), "高数");
assert.equal(deriveProjectFromPath("t3.txt"), null, "根级条目无项目");
assert.equal(deriveProjectFromPath("高数"), null, "无路径段 = 根级条目");
assert.equal(deriveProjectFromPath(""), null);

console.log("verify-project-fn: OK");
