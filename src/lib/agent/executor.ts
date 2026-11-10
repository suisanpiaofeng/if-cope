/**
 * 工具执行策略层（计划 Task 3 / 规格 §3.3）：
 * 按工具分类超时；只读工具失败/超时自动重试 1 次；写操作不重试（防重复移动/重复建类目）。
 * 失败 throw，由调用方（llm.ts）转错误文本回喂模型继续循环。
 */
import { executeTool, type ToolCall, type ToolContext } from "./tools";
import { withTimeout } from "./timeout";

/** 分类策略（规格 §3.3 表）：只读 15s 重试；web_search 30s 重试；写操作 10s 不重试；生成 120s 不重试 */
export const TOOL_POLICY: Record<string, { timeoutMs: number; retry: boolean }> = {
  list_library: { timeoutMs: 15_000, retry: true },
  read_source: { timeoutMs: 15_000, retry: true },
  web_search: { timeoutMs: 30_000, retry: true },
  move_source: { timeoutMs: 10_000, retry: false },
  move_artifact: { timeoutMs: 10_000, retry: false },
  create_category: { timeoutMs: 10_000, retry: false },
  todo_write: { timeoutMs: 10_000, retry: false },
  generate_summary: { timeoutMs: 120_000, retry: false },
};

const DEFAULT_POLICY = { timeoutMs: 10_000, retry: false };

/** 带分类超时/重试的工具执行 */
export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const policy = TOOL_POLICY[call.name] ?? DEFAULT_POLICY;
  const attempt = () => withTimeout(executeTool(call, ctx), policy.timeoutMs, `工具 ${call.name}`);
  try {
    return await attempt();
  } catch (e) {
    if (!policy.retry) throw e;
    return await attempt(); // 只读工具：失败/超时重试一次
  }
}
