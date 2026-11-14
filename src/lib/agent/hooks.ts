/**
 * 生命周期 Hooks（harness P2 §9.4）：
 * 工作区 `.ifcope/hooks.json` → pre_tool_use（非零退出=拦截工具）/ post_tool_use（旁路观察）。
 * 安全：hook 命令为用户显式配置（信任边界同 AGENTS.md），但黑名单命令仍拒跑（classifyCommand=deny 过滤）；
 * 执行走 executeCommand（cwd=工作区、safeEnv、输出清洗），10s 超时。
 */
import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./workspace.ts";
import { executeCommand } from "./command.ts";
import { classifyCommand } from "./confirm.ts";

export type Hook = { command: string; match?: string };
export type HookConfig = { pre: Hook[]; post: Hook[] };

/** 解析 hooks.json（容错：坏 json/坏条目丢弃不崩） */
export function parseHooksConfig(raw: string): HookConfig {
  try {
    const obj = JSON.parse(String(raw ?? "")) as { pre?: unknown[]; post?: unknown[] };
    const pick = (arr: unknown[]): Hook[] =>
      (Array.isArray(arr) ? arr : [])
        .map((h) => h as { command?: string; match?: string })
        .filter((h) => typeof h?.command === "string" && h.command.trim())
        .map((h) => ({ command: String(h.command).trim(), ...(h.match ? { match: String(h.match) } : {}) }));
    return { pre: pick(obj.pre ?? []), post: pick(obj.post ?? []) };
  } catch {
    return { pre: [], post: [] };
  }
}

/** glob 匹配（`*` 任意 / `write_*` 前缀 / 精确名）；缺省 match = `*` */
export function matchHooks(list: Hook[], toolName: string): Hook[] {
  return (list ?? []).filter((h) => {
    const m = h.match ?? "*";
    const re = new RegExp("^" + m.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(toolName);
  });
}

/** 黑名单过滤：危险命令的 hook 不跑（用户配置也不豁免硬拒） */
export function filterSafeHooks(list: Hook[]): Hook[] {
  return (list ?? []).filter((h) => classifyCommand(h.command) !== "deny");
}

// 配置缓存（3s TTL）
let cache: { at: number; cfg: HookConfig } | null = null;

export function loadHooks(): HookConfig {
  if (cache && Date.now() - cache.at < 3000) return cache.cfg;
  let cfg: HookConfig = { pre: [], post: [] };
  try {
    const f = path.join(workspaceRoot(), ".ifcope", "hooks.json");
    if (fs.existsSync(f)) cfg = parseHooksConfig(fs.readFileSync(f, "utf8"));
  } catch {
    /* 配置读取失败不阻塞工具 */
  }
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** pre_tool_use：按序执行匹配 hook；任一非零退出即拦截 */
export async function runPreToolHooks(toolName: string): Promise<{ blocked: boolean; output: string }> {
  const hooks = filterSafeHooks(matchHooks(loadHooks().pre, toolName));
  const outputs: string[] = [];
  for (const h of hooks) {
    const r = await executeCommand(h.command, 10_000).catch((e) => ({
      output: String(e instanceof Error ? e.message : e),
      truncated: false,
      code: 1,
      timedOut: false,
    }));
    outputs.push(r.output);
    if (r.code !== 0) return { blocked: true, output: outputs.join("\n").slice(0, 500) };
  }
  return { blocked: false, output: outputs.join("\n") };
}

/** post_tool_use：旁路观察（结果忽略、不阻塞主流程） */
export async function runPostToolHooks(toolName: string): Promise<void> {
  const hooks = filterSafeHooks(matchHooks(loadHooks().post, toolName));
  for (const h of hooks) {
    await executeCommand(h.command, 10_000).catch(() => null);
  }
}
