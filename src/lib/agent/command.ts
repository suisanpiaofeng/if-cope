/**
 * 受限命令执行（harness P0 规格 §4.3）：
 * cwd = 工作区根；超时默认 30s（≤120s）；stdout/stderr 合并；输出截断 20k。
 * 黑名单硬拒/白名单直跑/写类确认的分级在 confirm.ts（classifyCommand），本模块只负责执行。
 */
import { exec } from "node:child_process";
import { workspaceRoot, ensureWorkspace } from "./workspace.ts";

export type CommandResult = { output: string; truncated: boolean; code: number | null; timedOut: boolean };

const OUTPUT_MAX = 20_000;

export function executeCommand(command: string, timeoutMs: number = 30_000): Promise<CommandResult> {
  const t = Math.min(120_000, Math.max(1_000, timeoutMs));
  ensureWorkspace(); // cwd 不存在会让 spawn 直接 ENOENT
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: workspaceRoot(), timeout: t, maxBuffer: 10 * 1024 * 1024, windowsHide: true, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const e = err as (Error & { killed?: boolean; code?: number | string }) | null;
        const timedOut = Boolean(e?.killed);
        let out = `${stdout ?? ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;
        if (!out && e) out = String(e.message ?? e);
        const truncated = out.length > OUTPUT_MAX;
        resolve({
          output: truncated ? out.slice(0, OUTPUT_MAX) + `\n……（输出已截断，共 ${out.length} 字符）` : out,
          truncated,
          code: timedOut ? null : typeof e?.code === "number" ? e.code : e ? 1 : 0,
          timedOut,
        });
      }
    );
  });
}
