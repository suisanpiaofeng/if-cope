/**
 * 三档确认安全底座（harness P0 规格 §4）。
 * readonly（免确认）/ reversible（需确认）/ destructive（需强确认）/ deny（硬拒，不给确认）。
 * 确认流：askConfirmation 挂起 → 前端确认卡 POST /api/agent/confirm → resolveConfirmation 解除；
 * 60s 无响应自动拒绝（防刷新/离开死锁）。命令分级规范化后判（防大小写/引号/串联绕过）。
 */

export type Risk = "readonly" | "reversible" | "destructive" | "deny";

export const CONFIRM_TIMEOUT_MS = 60_000;

/** 工具静态分级（run_command 按命令内容动态判） */
export const TOOL_RISK: Record<string, Risk> = {
  list_library: "readonly",
  read_source: "readonly",
  list_files: "readonly",
  read_file: "readonly",
  search_code: "readonly",
  list_preferences: "readonly",
  load_skill: "readonly",
  move_source: "reversible",
  move_artifact: "reversible",
  create_category: "reversible",
  generate_summary: "reversible",
  todo_write: "reversible",
  save_preference: "reversible",
  delete_preference: "reversible",
  write_file: "reversible",
  edit_file: "reversible",
  create_skill: "reversible",
  install_skill: "reversible",
  mcp_list_tools: "readonly",
  mcp_call_tool: "reversible", // 外部工具副作用未知，保守走确认（P2 §9.3）
};

/** 命令黑名单（命中即 deny，硬拒不给确认；spec §4.3） */
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]+\s+)*(\/|~|c:)/i, // rm 指向根/家/系统盘
  /\bformat(\.exe)?\s/i,
  /\bmkfs/i,
  /\breg(\.exe)?\s+(add|delete)/i,
  /\bsudo\s/i,
  />\s*\/dev\//i,
  /\bdd\s+if=/i,
  /\bshutdown/i,
  /\btaskkill/i,
  /\bdel\b[^;&|]*\/s/i, // del /f /s 递归删除（spec 黑名单）
  />\s*[^|;&]*\.\./i, // 重定向逃逸到上级目录
];

/** 命令白名单前缀（只读直跑） */
const READONLY_PREFIXES = [
  "ls", "dir", "cat", "type", "pwd", "echo", "wc", "head", "tail", "grep", "find", "tree",
  "stat", "file", "du", "df", "which", "where", "hostname", "date", "whoami",
  "node -v", "node --version", "npm -v", "npm --version",
  "git status", "git log", "git diff", "git show", "git branch", "git remote",
];

/** 写类/删除类命令（强确认） */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\b/i,
  /\bdel\b/i,
  /\brmdir\b/i,
  /\bgit\s+(push|reset|clean|rebase)/i,
  /\bnpm\s+(install|ci|publish)/i,
  /\bpip\s+install/i,
  /\b(chmod|chown)\b/i,
];

function normalizeCommand(cmd: string): string {
  return String(cmd ?? "").trim().toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ");
}

/** 命令分级：规范化（小写/去引号/压空白）+ 按 shell 分隔符切段，任一段命中黑名单即 deny */
export function classifyCommand(cmd: string): Risk {
  const norm = normalizeCommand(cmd);
  if (!norm) return "deny";
  const segments = norm.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  if (segments.some((s) => DENY_PATTERNS.some((re) => re.test(s)))) return "deny";
  const isReadonly = (s: string) => !s.includes(">") && READONLY_PREFIXES.some((p) => s === p || s.startsWith(p + " "));
  if (segments.every(isReadonly)) return "readonly";
  if (segments.some((s) => DESTRUCTIVE_PATTERNS.some((re) => re.test(s)))) return "destructive";
  return "reversible";
}

/** 工具分级：run_command 按命令细分并套 commandPolicy（P1 §7.5）；未知工具按 reversible（保守需确认） */
export function classifyTool(name: string, args: Record<string, unknown> = {}, commandPolicy: string = "normal"): Risk {
  if (name === "run_command") {
    const risk = classifyCommand(String(args?.command ?? ""));
    return commandPolicyAllows(commandPolicy, risk) ? risk : "deny";
  }
  return TOOL_RISK[name] ?? "reversible";
}

/** 命令策略（P1 §7.5）：off 全拒；readonly 仅只读放行；normal 仅拒 deny */
export function commandPolicyAllows(policy: string, risk: Risk): boolean {
  if (risk === "deny") return false;
  if (policy === "off") return false;
  if (policy === "readonly") return risk === "readonly";
  return true; // normal
}

/** 确认模式是否放行该风险：deny 永不放行；none 全放；writes 只放 readonly；all 全需确认 */
export function confirmModeAllows(mode: string, risk: Risk): boolean {
  if (risk === "deny") return false;
  if (mode === "none") return true;
  if (mode === "all") return false;
  return risk === "readonly"; // 默认 writes
}

type Pending = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
// 挂 globalThis：Next.js 各路由是独立模块实例，普通模块级 Map 不跨路由共享
const g = globalThis as { __ifcopePendingConfirms?: Map<string, Pending> };
const pending: Map<string, Pending> = g.__ifcopePendingConfirms ?? (g.__ifcopePendingConfirms = new Map());

/** 挂起一次确认；timeoutMs 后自动拒绝（防死锁） */
export function askConfirmation(
  callId: string,
  _risk: Risk,
  _name: string,
  _args: Record<string, unknown>,
  timeoutMs: number = CONFIRM_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(callId);
      resolve(false);
    }, timeoutMs);
    pending.set(callId, { resolve, timer });
  });
}

/** 前端确认回调；未知/超时 callId 返回 false */
export function resolveConfirmation(callId: string, approve: boolean): boolean {
  const p = pending.get(callId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(callId);
  p.resolve(approve);
  return true;
}
