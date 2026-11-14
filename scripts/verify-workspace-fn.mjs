// 工作区核心验证（计划 P0 T1：root 解析/路径安全/文件树）
// 运行：node scripts/verify-workspace-fn.mjs（IFCOPE_WORKSPACE_DIR 指临时目录隔离）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ifcope-ws-"));
process.env.IFCOPE_WORKSPACE_DIR = TMP;

const { workspaceRoot, resolveInWorkspace, relPath, listFilesTree, ensureWorkspace } = await import("../src/lib/agent/workspace.ts");

// 1. root 解析：env 优先
assert.equal(workspaceRoot(), path.resolve(TMP), "env 应优先");

// 2. 路径安全：合法路径落 root 内；穿越/绝对盘符/空=根
assert.equal(resolveInWorkspace("a/b.txt"), path.join(path.resolve(TMP), "a", "b.txt"));
assert.equal(resolveInWorkspace(""), path.resolve(TMP), "空路径 = root 自身");
for (const bad of ["../x", "a/../../x", "C:/Windows", "..", "/etc/passwd"]) {
  assert.throws(() => resolveInWorkspace(bad), /路径超出工作区/, bad);
}

// 3. relPath 往返一致
assert.equal(relPath(resolveInWorkspace("a/b.txt")), "a/b.txt");

// 4. 文件树：3 层嵌套，depth 截断、dir/file 节点、path 用 /
fs.mkdirSync(path.join(TMP, "a", "b"), { recursive: true });
fs.writeFileSync(path.join(TMP, "top.txt"), "x");
fs.writeFileSync(path.join(TMP, "a", "b", "c.txt"), "y");
const tree = listFilesTree();
const paths = tree.map((n) => n.path);
assert.ok(paths.includes("a") && paths.includes("a/b") && paths.includes("top.txt"), `默认 depth=2 应含 1/2 层：${paths}`);
assert.ok(!paths.includes("a/b/c.txt"), "depth=2 不应含第 3 层");
const d1 = listFilesTree("", 1).map((n) => n.path);
assert.ok(d1.includes("a") && d1.includes("top.txt") && !d1.includes("a/b"), "depth=1 只含第 1 层");
const dirNode = tree.find((n) => n.path === "a");
assert.equal(dirNode?.type, "dir");
const fileNode = tree.find((n) => n.path === "top.txt");
assert.equal(fileNode?.type, "file");
assert.equal(fileNode?.size, 1);

// 5. ensureWorkspace 幂等（不存在则建）
process.env.IFCOPE_WORKSPACE_DIR = path.join(TMP, "sub", "ws");
ensureWorkspace();
assert.ok(fs.existsSync(path.join(TMP, "sub", "ws")), "应创建缺失目录");

fs.rmSync(TMP, { recursive: true, force: true });
console.log("verify-workspace-fn: OK");

// 6. buildWorkspaceSection（P2 T1）：AGENTS.md 注入/缺失不注入（需在 rmSync 前跑——此处复用独立临时目录）
{
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), "ifcope-ws2-"));
  process.env.IFCOPE_WORKSPACE_DIR = T2;
  const { buildWorkspaceSection } = await import("../src/lib/agent/workspace.ts");
  assert.ok(!buildWorkspaceSection().includes("项目配置"), "无 AGENTS.md 不应注入");
  fs.mkdirSync(path.join(T2, ".ifcope"), { recursive: true });
  fs.writeFileSync(path.join(T2, ".ifcope", "AGENTS.md"), "【测试配置】回答带暗号X");
  assert.ok(buildWorkspaceSection().includes("回答带暗号X"), "AGENTS.md 内容应注入");
  fs.rmSync(T2, { recursive: true, force: true });
}
console.log("verify-workspace-fn: AGENTS.md 注入 OK");
