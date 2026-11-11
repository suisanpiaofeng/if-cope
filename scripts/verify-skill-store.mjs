// 技能存储验证（计划三期 Task 1：frontmatter 解析/名称校验/截断/索引文本）
// 运行：node scripts/verify-skill-store.mjs
import assert from "node:assert/strict";
import { parseSkillFile, isValidSkillName, buildSkillsIndexText, BODY_MAX, DESC_MAX } from "../src/lib/agent/skills.ts";

// 1. 正常解析：name 取目录名（覆盖 frontmatter）、enabled 默认 true、正文去 frontmatter
const good = `---\nname: other-name\ndescription: 复习计划用\n---\n# 标题\n正文内容`;
const p = parseSkillFile(good, "exam-plan");
assert.equal(p.name, "exam-plan");
assert.equal(p.description, "复习计划用");
assert.equal(p.enabled, true);
assert.equal(p.error, undefined);
assert.ok(p.body.startsWith("# 标题"));

// 2. enabled: false 解析；缺 enabled 默认 true
assert.equal(parseSkillFile(`---\nname: a\nenabled: false\n---\nx`, "a").enabled, false);
assert.equal(parseSkillFile(`---\nname: a\n---\nx`, "a").enabled, true);

// 3. 错误分支：缺 frontmatter / 缺 name → error，且 enabled 强制 false
assert.ok(parseSkillFile("没有 frontmatter", "a").error);
assert.ok(parseSkillFile(`---\ndescription: x\n---\ny`, "a").error);
for (const bad of [parseSkillFile("x", "a"), parseSkillFile(`---\nd: 1\n---\ny`, "a")]) {
  assert.equal(bad.enabled, false);
  assert.equal(bad.body, "");
}

// 4. 名称校验：非法一律 false
for (const n of ["../evil", "MySkill", "a b", "a.b", "", "x".repeat(41)]) assert.equal(isValidSkillName(n), false, n);
assert.equal(isValidSkillName("exam-plan"), true);

// 5. 截断：正文 >8000 → 精确等于 8000 字 + 后缀；description >300 截到 300 无后缀
const long = parseSkillFile(`---\nname: a\n---\n${"x".repeat(9000)}`, "a");
assert.equal(long.body, "x".repeat(BODY_MAX) + "……（已截断）");
const longDesc = parseSkillFile(`---\nname: a\ndescription: ${"d".repeat(400)}\n---\nx`, "a");
assert.equal(longDesc.description.length, DESC_MAX);

// 6. 索引段：只收 enabled && !error；格式含序号与破折号；全空返回 ""
const idx = buildSkillsIndexText([
  { name: "a", description: "A用", enabled: true, body: "" },
  { name: "b", description: "B用", enabled: false, body: "" },
  { name: "c", description: "C用", enabled: true, body: "", error: "坏文件" },
]);
assert.ok(idx.startsWith("<skills>") && idx.endsWith("</skills>"));
assert.ok(idx.includes("1. a — A用") && !idx.includes("b —") && !idx.includes("c —"));
assert.equal(buildSkillsIndexText([]), "");

console.log("verify-skill-store: 解析层 OK");
