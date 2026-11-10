/**
 * 工具时间线合并（计划 Task 2）。
 * 纯函数、零运行时依赖（verify 脚本可裸 Node 跑）。
 * 事件输入用结构类型 ToolEventLike：llm.ts 的 ToolEvent 在 Task 4 扩展后与之结构兼容
 * （本模块先行，不能 import llm.ts 的类型，否则类型悬空——见 ledger 预检裁决）。
 */
export type ToolPhase = "run" | "done" | "error";

export type LiveTool = {
  callId?: string;
  name: string;
  round: number;
  intent?: string;
  phase: ToolPhase;
  detail?: string;
};

export type ToolEventLike = {
  callId?: string;
  name: string;
  phase: "start" | "done" | "error";
  detail?: string;
  round?: number;
  intent?: string;
};

/** 合并一个工具事件到时间线（纯函数，不改入参数组，返回新数组）。
 *  phase 映射 "start"→"run"；有 callId 按 callId 精确匹配（未知 callId 追加）；
 *  无 callId 的旧事件按 name 兜底匹配首个 run 态条目，找不到则追加。 */
export function mergeTool(list: LiveTool[], ev: ToolEventLike): LiveTool[] {
  const phase: ToolPhase = ev.phase === "start" ? "run" : ev.phase;
  const idx = ev.callId
    ? list.findIndex((t) => t.callId === ev.callId)
    : list.findIndex((t) => t.name === ev.name && t.phase === "run");
  const base: LiveTool | undefined = idx >= 0 ? list[idx] : undefined;
  const merged: LiveTool = {
    callId: ev.callId ?? base?.callId,
    name: ev.name,
    round: ev.round ?? base?.round ?? 0,
    intent: ev.intent ?? base?.intent,
    phase,
    detail: ev.detail ?? base?.detail,
  };
  return idx >= 0 ? list.map((t, i) => (i === idx ? merged : t)) : [...list, merged];
}
