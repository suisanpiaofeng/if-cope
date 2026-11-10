// Agent 纯函数底座验证（计划 Task 2：mergeTool 时间线合并 / withTimeout 超时 / LoopGuard 护栏）
// 运行：node scripts/verify-agent-core.mjs（Node ≥22.6 原生 TS 支持；模块零运行时依赖可裸跑）
import assert from "node:assert/strict";
import { mergeTool } from "../src/lib/agent/timeline.ts";
import { withTimeout } from "../src/lib/agent/timeout.ts";
import { LoopGuard } from "../src/lib/agent/loopGuards.ts";

// ── withTimeout ──
// 1a. 10ms 内 resolve 的 promise 原值返回
{
  const v = await withTimeout(Promise.resolve(42), 10, "fast");
  assert.equal(v, 42, "应原值返回");
}
// 1b. 超时 reject 且 message 含"超时"
{
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 5, "x"),
    (e) => e instanceof Error && e.message.includes("超时"),
    "应以含'超时'的错误 reject"
  );
}

// ── mergeTool ──
const start = (callId, name, round = 1, intent) => ({ callId, name, phase: "start", round, intent });
const done = (callId, name, detail = "ok", round = 1) => ({ callId, name, phase: "done", detail, round });

// 2a. "start" 事件入表后 phase 为 "run"；同名不同 callId 两条并存
{
  const list = [];
  const l1 = mergeTool(list, start("a1", "read_source"));
  const l2 = mergeTool(l1, start("a2", "read_source"));
  assert.equal(l2.length, 2, "同名不同 callId 应并存两条");
  assert.equal(l2[0].phase, "run", "start 应映射为 run");
  assert.equal(l2[1].phase, "run");
}
// 2b. 对 a2 的 done 事件只更新第二条
{
  let list = [];
  list = mergeTool(list, start("a1", "read_source"));
  list = mergeTool(list, start("a2", "read_source"));
  const out = mergeTool(list, done("a2", "read_source", "r2"));
  assert.equal(out[0].phase, "run", "a1 不应被 a2 的 done 影响");
  assert.equal(out[1].phase, "done");
  assert.equal(out[1].detail, "r2");
}
// 2c. 无 callId 的 done 事件按 name 兜底更新首个 run 态条目
{
  let list = [];
  list = mergeTool(list, start("a1", "read_source"));
  list = mergeTool(list, start("a2", "read_source"));
  const out = mergeTool(list, { name: "read_source", phase: "done", detail: "legacy" });
  assert.equal(out[0].phase, "done", "应兜底更新首个 run 态条目");
  assert.equal(out[0].detail, "legacy");
  assert.equal(out[1].phase, "run", "第二条不受影响");
}
// 2d. 未知 callId 的 done 事件追加为独立条目
{
  let list = mergeTool([], start("a1", "read_source"));
  const out = mergeTool(list, done("z9", "web_search"));
  assert.equal(out.length, 2, "未知 callId 应追加");
  assert.equal(out[1].phase, "done");
}
// 2e. 入参数组不被修改（纯函数）
{
  const list = [start("a1", "read_source")];
  const snapshot = JSON.stringify(list);
  mergeTool(list, done("a1", "read_source"));
  assert.equal(JSON.stringify(list), snapshot, "入参不应被修改");
}

// ── LoopGuard ──
// 3a. 同参调用前 2 次 null、第 3 次含"重复调用"
{
  const g = new LoopGuard();
  assert.equal(g.record("t", '{"x":1}'), null);
  assert.equal(g.record("t", '{"x":1}'), null);
  const w = g.record("t", '{"x":1}');
  assert.ok(w && w.includes("重复调用"), "第 3 次同参应提示重复调用");
}
// 3b. 不同参数不触发重复计数
{
  const g = new LoopGuard();
  assert.equal(g.record("t", '{"x":1}'), null);
  assert.equal(g.record("t", '{"x":2}'), null);
  assert.equal(g.record("t", '{"x":3}'), null);
}
// 3c. 连续调用 17 次中第 17 次返回含"预算"的提示
{
  const g = new LoopGuard();
  let budgetWarn = null;
  for (let i = 1; i <= 17; i++) budgetWarn = g.record("t", `{"i":${i}}`);
  assert.ok(budgetWarn && budgetWarn.includes("预算"), "第 17 次应提示预算用尽");
}

console.log("verify-agent-core: all pass");
