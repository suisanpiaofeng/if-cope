// agent_todos 存储验证（计划 Task 1：getTodos/replaceTodos 幂等覆盖、三态、排序）
// 运行：node scripts/verify-todo-store.mjs（Node ≥22.6 原生 TS 支持）
// 使用哨兵 thread_id=-999，验证后清理，不污染真实数据。
import assert from "node:assert/strict";
import { getTodos, replaceTodos } from "../src/lib/agent/todo.ts";
import db from "../src/lib/db.ts";

const TID = -999;
try {
  // 幂等覆盖：先写 2 条，再整体替换成 3 条，应得 3 条而非 5 条
  replaceTodos(TID, [
    { id: 1, text: "a", status: "pending" },
    { id: 2, text: "b", status: "in_progress" },
  ]);
  replaceTodos(TID, [
    { id: 3, text: "c", status: "completed" },
    { id: 1, text: "a", status: "pending" },
    { id: 2, text: "b", status: "in_progress" },
  ]);
  let todos = getTodos(TID);
  assert.equal(todos.length, 3, "整体覆盖应为 3 条");
  // 按 item_id 升序
  assert.deepEqual(
    todos.map((t) => t.id),
    [1, 2, 3],
    "应按 item_id 升序"
  );
  assert.deepEqual(
    todos.map((t) => t.status),
    ["pending", "in_progress", "completed"],
    "三态应原样保留"
  );
  // 三态之外的值按 pending 落库
  replaceTodos(TID, [{ id: 1, text: "x", status: "bogus" }]);
  todos = getTodos(TID);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].status, "pending", "非法 status 应落为 pending");
  assert.equal(todos[0].text, "x");
  // 空清单 = 清空
  replaceTodos(TID, []);
  assert.equal(getTodos(TID).length, 0, "空清单应清空");
  // thread 隔离：其他 thread 的数据不受影响
  assert.equal(getTodos(TID + 1).length, 0, "不应读到其他 thread 的清单");
  console.log("verify-todo-store: all pass");
} finally {
  db.prepare("DELETE FROM agent_todos WHERE thread_id = ?").run(TID);
}
