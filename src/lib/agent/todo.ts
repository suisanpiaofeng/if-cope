/**
 * Agent 任务清单存储（规格 §3.1，plan Task 1）。
 * 会话级（thread_id）任务清单：模型经 todo_write 整体覆盖写入，用户可经 API 手改——人机共写同一份。
 * 幂等：replaceTodos 每次整体替换（事务先删后插）。
 */
import db from "../db.ts"; // 相对路径+扩展名：verify 脚本裸 Node 可跑（@/ 别名 Node 不认），Next 两种都兼容

export type TodoItem = { id: number; text: string; status: "pending" | "in_progress" | "completed" };

const STATUSES = new Set(["pending", "in_progress", "completed"]);

/** 读某会话任务清单（按 item_id 升序） */
export function getTodos(threadId: number): TodoItem[] {
  return db
    .prepare(
      `SELECT item_id AS id, text, status FROM agent_todos WHERE thread_id = ? ORDER BY item_id ASC`
    )
    .all(threadId) as TodoItem[];
}

/** 整体覆盖写入（事务先删后插；status 三态之外的值按 pending 落库） */
export function replaceTodos(threadId: number, items: TodoItem[]): void {
  const now = Date.now();
  const del = db.prepare("DELETE FROM agent_todos WHERE thread_id = ?");
  const ins = db.prepare(
    "INSERT INTO agent_todos (thread_id, item_id, text, status, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    del.run(threadId);
    for (const it of items) {
      const id = Number(it.id);
      const text = String(it.text ?? "");
      if (!Number.isInteger(id) || !text.trim()) continue; // 非法条目跳过，不半包写入
      const status = STATUSES.has(it.status) ? it.status : "pending";
      ins.run(threadId, id, text, status, now);
    }
  })();
}
