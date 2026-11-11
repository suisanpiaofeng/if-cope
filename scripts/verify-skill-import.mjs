// skill 导入验证（计划 P0 T6：元数据自动生成/两步式冲突处理）
// 运行：node scripts/verify-skill-import.mjs
import assert from "node:assert/strict";
const { deriveSkillName, autoDescription, planImport } = await import("../src/lib/agent/skillImport.ts");
const { parseSkillFile } = await import("../src/lib/agent/skills.ts");

// 1. deriveSkillName：slug 化/压缩/截 40/去首尾连字符
assert.equal(deriveSkillName("My Plan.md"), "my-plan");
assert.equal(deriveSkillName("a_b..c.md"), "a-b-c");
assert.equal(deriveSkillName("x".repeat(50) + ".md").length, 40);
assert.equal(deriveSkillName("-hello-.md"), "hello");

// 2. autoDescription：triggers 优先；否则正文首行去 Markdown 标记
assert.equal(autoDescription("# 标题 **粗**\n正文", "条件A,条件B"), "条件A,条件B");
assert.equal(autoDescription("# 标题 **粗**\n正文", ""), "标题 粗");

// 3. 纯 md 无 frontmatter 也能装（元数据自动生成）
const r1 = planImport([{ path: "pack/plain.md", content: "# 纯文档\n正文内容" }], []);
assert.equal(r1.installs.length, 1);
assert.equal(r1.installs[0].name, "plain");
assert.equal(r1.installs[0].description, "纯文档");
assert.equal(r1.conflicts.length, 0);

// 4. frontmatter triggers/params 透传（parseSkillFile 扩展）
const p = parseSkillFile("---\nname: a\ndescription: d\ntriggers: t1,t2\nparams: p1\n---\nbody", "a");
assert.equal(p.triggers, "t1,t2");
assert.equal(p.params, "p1");

// 5. 冲突检测：已存在 + 同批重复都算冲突
const r2 = planImport(
  [
    { path: "a.md", content: "---\nname: dup\n---\nx" },
    { path: "b.md", content: "---\nname: dup\n---\ny" },
  ],
  ["dup"]
);
assert.equal(r2.conflicts.length, 2, "existing 与同批都算冲突");

// 6. resolutions：overwrite / rename（name-2 被占取 name-3）/ skip
const r3 = planImport(
  [
    { path: "a.md", content: "---\nname: dup\n---\nx" },
    { path: "b.md", content: "---\nname: dup\n---\ny" },
    { path: "c.md", content: "---\nname: dup\n---\nz" },
  ],
  ["dup", "dup-2"],
  { "a.md": "overwrite", "b.md": "rename", "c.md": "skip" }
);
assert.equal(r3.installs.length, 2);
assert.equal(r3.installs.find((i) => i.path === "a.md")?.overwrite, true);
assert.equal(r3.renames[0].to, "dup-3", "dup-2 已被占，取 dup-3");
assert.ok(!r3.installs.some((i) => i.path === "c.md"));
assert.equal(r3.skipped.length, 1);

// 7. 错误条目：frontmatter name 非法 / 空内容
const r4 = planImport(
  [
    { path: "x.md", content: "---\nname: BAD NAME\n---\nx" },
    { path: "y.md", content: "" },
  ],
  []
);
assert.equal(r4.errors.length, 2);
assert.equal(r4.installs.length, 0);

console.log("verify-skill-import: OK");
