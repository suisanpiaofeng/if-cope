// 历史分层截断验证（计划二期 Task 4：foldHistory——预算内折叠旧行、保留最近 2 条）
// 运行：node scripts/verify-context-fold.mjs
import assert from "node:assert/strict";
import { foldHistory } from "../src/lib/agent/context.ts";

// 1. 短历史（预算内）原样返回，零变化
{
  const h = [
    { role: "user", content: "什么是傅里叶变换？" },
    { role: "assistant", content: "傅里叶变换是…" },
    { role: "user", content: "举个例子" },
    { role: "assistant", content: "例如…" },
  ];
  const out = foldHistory(h, 4000);
  assert.deepEqual(out, h, "预算内应原样返回（短对话零回归）");
}

// 2. 长历史：最近 2 条完整保留、旧行折叠为一条 system 占位
{
  const long = (s) => "x".repeat(600); // 约 200 tokens/条
  const h = [];
  for (let i = 0; i < 20; i++) {
    h.push({ role: "user", content: `第${i}个问题：${long()}` });
    h.push({ role: "assistant", content: `第${i}个回答：${long()}` });
  }
  const out = foldHistory(h, 4000);
  assert.ok(out.length < h.length, "超预算应折叠");
  assert.deepEqual(out.slice(-2), h.slice(-2), "最近 2 条应完整保留");
  const first = out[0];
  assert.equal(first.role, "system", "折叠占位应为 system 角色");
  assert.ok(first.content.includes("已省略"), "占位应含'已省略'");
  assert.ok(first.content.includes("第0个问题".slice(0, 40)), "占位应含首条被折用户内容前 40 字");
  // 输出后段应与原历史尾部对齐（除占位外全部原样）
  assert.deepEqual(out.slice(1), h.slice(-(out.length - 1)), "未折段应原样");
}

// 3. 折叠输出无连续 system、无空内容消息
{
  const h = [];
  for (let i = 0; i < 30; i++) {
    h.push({ role: "user", content: `q${i} ` + "y".repeat(400) });
    h.push({ role: "assistant", content: `a${i} ` + "y".repeat(400) });
  }
  const out = foldHistory(h, 2000);
  for (let i = 1; i < out.length; i++) {
    assert.ok(!(out[i].role === "system" && out[i - 1].role === "system"), "不应有连续 system");
    assert.ok(out[i].content.length > 0, "不应有空内容消息");
  }
}

// 4. 单条超预算：只折旧的，不动新的
{
  const h = [
    { role: "user", content: "z".repeat(15000) }, // 单条即超 4000 预算（约 5000 tokens）
    { role: "assistant", content: "短回答" },
    { role: "user", content: "新问题" },
    { role: "assistant", content: "新回答" },
  ];
  const out = foldHistory(h, 4000);
  assert.deepEqual(out.slice(-2), h.slice(-2), "新消息不受影响");
  assert.equal(out[0].role, "system", "旧超大条应被折叠");
}

console.log("verify-context-fold: all pass");
