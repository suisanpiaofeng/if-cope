/**
 * 历史分层截断（二期规格 §3.4，plan Task 4）。
 * 纯函数零依赖（verify 脚本裸 Node 可跑）。token 估算用字符数/3 近似（与 estimateTokens 同思路）。
 * 策略：预算内原样返回（短对话零回归）；超预算时保留最近 2 条，
 * 更早的连续段折叠为一条 system 占位（含条数与首问前 40 字，模型知有省略即可——本期不做真摘要）。
 */

type Msg = { role: string; content: string };

/** 单条消息的近似 token 成本（字符/3 + 结构开销） */
function cost(m: Msg): number {
  return Math.ceil(m.content.length / 3) + 4;
}

export function foldHistory<T extends Msg>(history: T[], budgetTokens = 4000): T[] {
  if (history.length <= 2) return history;
  const total = history.reduce((s, m) => s + cost(m), 0);
  if (total <= budgetTokens) return history;

  // 至少保留最近 2 条；从尾部往前塞，塞不下为止
  const placeholderCost = 30;
  let keepStart = history.length - 2;
  let acc = cost(history[history.length - 1]) + cost(history[history.length - 2]);
  for (let i = history.length - 3; i >= 0; i--) {
    if (acc + cost(history[i]) > budgetTokens - placeholderCost) break;
    acc += cost(history[i]);
    keepStart = i;
  }
  if (keepStart === 0) return history; // 全放得下（防御）

  const folded = history.slice(0, keepStart);
  const firstUser = folded.find((m) => m.role === "user");
  const topic = (firstUser?.content ?? folded[0].content).slice(0, 40).replace(/\s+/g, " ");
  const placeholder = {
    role: "system",
    content: `（此前 ${folded.length} 条对话已省略，话题：${topic}）`,
  } as T;
  return [placeholder, ...history.slice(keepStart)];
}
