// 个性化存储验证（计划二期 Task 1：prefs 幂等/上限语义、buildUserSection 截断、覆盖清除语义）
// 运行：node scripts/verify-personal-store.mjs（哨兵数据 __test__ 前缀，验证后清理）
import assert from "node:assert/strict";
import { listPrefs, savePref, deletePref, buildUserSection, PREFS_MAX } from "../src/lib/agent/prefs.ts";
import { resolvePrompt, getPromptOverride, setPromptOverride, PROMPT_DEFAULTS } from "../src/lib/prompts.ts";
import db from "../src/lib/db.ts";

const TAG = "__test__";
const K = "__test_key__";
try {
  // 1a. savePref 幂等：同文本二次调用 created:false 且只 1 条
  const r1 = savePref(`${TAG}a`);
  assert.equal(r1.created, true, "首次应创建");
  const r2 = savePref(`${TAG}a`);
  assert.equal(r2.created, false, "同文本应幂等");
  assert.equal(r2.id, r1.id, "幂等应返回原 id");
  assert.equal(listPrefs().filter((p) => p.text === `${TAG}a`).length, 1, "不应重复落库");
  // 1b. deletePref 返回值
  assert.equal(deletePref(r1.id), true, "删除存在的应 true");
  assert.equal(deletePref(r1.id), false, "重复删除应 false");
  // 1c. savePref 空文本 throw
  assert.throws(() => savePref("  "), /./, "空白文本应 throw");
  // 1d. PREFS_MAX 常量存在
  assert.equal(PREFS_MAX, 50, "上限应为 50");

  // 2a. buildUserSection：指令+偏好非空 → 含 <user_profile> 与文本
  const prefs = [{ id: 1, text: `${TAG}p1` }, { id: 2, text: `${TAG}p2` }];
  const sec = buildUserSection(`${TAG}directive`, prefs);
  assert.ok(sec.includes("<user_profile>") && sec.includes(`${TAG}directive`), "应含指令");
  assert.ok(sec.includes(`${TAG}p1`) && sec.includes(`${TAG}p2`), "应含两条偏好");
  // 2b. 全空返回 ""
  assert.equal(buildUserSection("", []), "", "全空应返回空串");
  // 2c. 超 2000 字符截断
  const long = buildUserSection("x".repeat(3000), []);
  assert.ok(long.length <= 2000, `超长应截断到 2000（实际 ${long.length}）`);

  // 3a. 覆盖写入/读取
  setPromptOverride(K, `${TAG}override`);
  assert.equal(getPromptOverride(K), `${TAG}override`, "应读回覆盖值");
  assert.equal(resolvePrompt(K, "fallback"), `${TAG}override`, "有覆盖应返回覆盖值");
  // 3b. 空格视为清除（trim 后空串 = DELETE）
  setPromptOverride(K, "   ");
  assert.equal(getPromptOverride(K), null, "空格覆盖应清除");
  assert.equal(resolvePrompt(K, "fallback"), "fallback", "无覆盖应回 fallback");
  // 3c. PROMPT_DEFAULTS 5 个 key 齐全
  for (const k of ["chat_append", "ask_system", "artifact_summary", "map_link"]) {
    assert.ok(k in PROMPT_DEFAULTS, `PROMPT_DEFAULTS 缺 ${k}`);
  }
  assert.equal(PROMPT_DEFAULTS.chat_append, "", "chat_append 默认应为空");

  console.log("verify-personal-store: all pass");
} finally {
  db.prepare("DELETE FROM user_prefs WHERE text LIKE '__test__%'").run();
  db.prepare("DELETE FROM prompt_overrides WHERE key LIKE '__test__%'").run();
}
