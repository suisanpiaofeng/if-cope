// 统一文件树验证（计划 P3-1 T1：文件名清洗/去重/路径映射）
// 运行：node scripts/verify-file-fn.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.IFCOPE_WORKSPACE_DIR = path.join(os.tmpdir(), "ifcope-ft-test");
const { titleToFilename, sourcePath } = await import("../src/lib/fileTree.ts");

// 1. 基本：标题 + 扩展名
assert.equal(titleToFilename("高数 讲义", "pdf", new Set()), "高数 讲义.pdf");

// 2. 非法字符逐个转 _，去首尾空格/点（Windows 兼容）
assert.equal(titleToFilename('a/b:c*?"<>|', "md", new Set()), "a_b_c______.md"); // 8 个非法字符→8 个 _（a_b_c 含 2 个，尾 6 个）
assert.equal(titleToFilename("  点结尾...  ", "md", new Set()), "点结尾.md");

// 3. 去重：-2/-3（大小写不敏感，Windows 文件系统）
assert.equal(titleToFilename("同名", "md", new Set(["同名.md"])), "同名-2.md");
assert.equal(titleToFilename("同名", "md", new Set(["同名.md", "同名-2.md"])), "同名-3.md");
assert.equal(titleToFilename("Same", "md", new Set(["same.md"])), "Same-2.md");

// 4. 超长截 80 字（不含扩展名）；空标题兜底
assert.equal(titleToFilename("x".repeat(100), "md", new Set()), "x".repeat(80) + ".md");
assert.equal(titleToFilename("", "md", new Set()), "未命名.md");

// 5. sourcePath：path 优先；旧散列文件兜底 uploads/
assert.equal(sourcePath({ path: "资料/a.md", filename: "a.md", storage_name: "u.txt" }), path.join(process.env.IFCOPE_WORKSPACE_DIR, "资料", "a.md"));
assert.equal(sourcePath({ path: null, filename: "u.txt" }), path.join(process.cwd(), "data", "uploads", "u.txt"));

console.log("verify-file-fn: OK");
