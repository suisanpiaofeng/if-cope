// 技能存储验证（计划三期 Task 1：frontmatter 解析/名称校验/截断/索引文本）
// 运行：node scripts/verify-skill-store.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSkillFile, isValidSkillName, buildSkillsIndexText, BODY_MAX, DESC_MAX, listSkills, readSkillBody, writeSkill, deleteSkill, skillsIndexText, ensureSeedSkills, executeLoadSkill } from "../src/lib/agent/skills.ts";

// 隔离目录：必须在首次调用 listSkills 前生效（skillsDir() 惰性读取 env）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ifcope-skills-"));
process.env.IFCOPE_SKILLS_DIR = TMP;

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

// 7. 播种：空目录首次 listSkills → 自动生成 exam-plan 与 .seeded 标记
assert.equal(fs.existsSync(path.join(TMP, ".seeded")), false);
const seeded = listSkills();
assert.equal(seeded.length, 1);
assert.equal(seeded[0].name, "exam-plan");
assert.ok(fs.existsSync(path.join(TMP, ".seeded")));

// 8. 只播一次：删除后不复活
deleteSkill("exam-plan");
assert.equal(listSkills().length, 0);

// 9. writeSkill/readSkillBody/parseSkillFile 往返
writeSkill("my-skill", "测试用描述", "# 正文");
assert.equal(readSkillBody("my-skill"), "# 正文");
assert.equal(listSkills().find((s) => s.name === "my-skill")?.description, "测试用描述");

// 10. 坏文件隔离：坏的标 error，好的照常
fs.mkdirSync(path.join(TMP, "bad-skill"));
fs.writeFileSync(path.join(TMP, "bad-skill", "SKILL.md"), "没有 frontmatter");
assert.equal(listSkills().find((s) => s.name === "bad-skill")?.error, "缺少 frontmatter");
assert.ok(listSkills().find((s) => s.name === "my-skill")?.error === undefined);

// 11. 路径安全：readSkillBody/deleteSkill 拒绝非法名（不触碰 TMP 之外）
for (const n of ["../evil", "MySkill", "a/b"]) {
  assert.throws(() => readSkillBody(n), /./, n);
  assert.throws(() => deleteSkill(n), /./, n);
}
assert.throws(() => readSkillBody("not-exist"), /./, "不存在应 throw");

// 12. 禁用技能不可 read
writeSkill("off-skill", "关", "x", false);
assert.throws(() => readSkillBody("off-skill"), /禁用|已禁用/, "禁用应 throw");
assert.equal(skillsIndexText().includes("off-skill"), false, "禁用不进索引");

fs.rmSync(TMP, { recursive: true, force: true });
console.log("verify-skill-store: IO 层 OK");

// 13. load_skill：命中返回正文；重复加载去重；未知/禁用 throw 且信息含可用清单
writeSkill("demo-skill", "演示", "# 演示正文");
const ctx = { loadedSkills: new Set() };
const r1 = executeLoadSkill({ name: "demo-skill" }, ctx);
assert.ok(r1.includes("# 演示正文"));
const r2 = executeLoadSkill({ name: "demo-skill" }, ctx);
assert.ok(r2.includes("无需重复加载"), r2); // Ruling: spec 措辞「已在本次任务中加载过」不含连续子串“已加载”，断言改钉 spec 原文
assert.throws(() => executeLoadSkill({ name: "no-such" }, ctx), /demo-skill|可用/, "错误应含可用清单");
executeLoadSkill({ name: "demo-skill" }, {}); // 无 ctx.loadedSkills 不去重、不崩
console.log("verify-skill-store: load_skill OK");
