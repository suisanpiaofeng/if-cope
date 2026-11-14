/**
 * 受限命令执行（harness P0 规格 §4.3）：
 * cwd = 工作区根；超时默认 30s（≤120s）；stdout/stderr 合并；输出截断 20k。
 * 黑名单硬拒/白名单直跑/写类确认的分级在 confirm.ts（classifyCommand），本模块只负责执行。
 */
import { exec } from "node:child_process";
import { workspaceRoot, ensureWorkspace } from "./workspace.ts";
import { stripAnsi } from "./errors.ts";

export type CommandResult = { output: string; truncated: boolean; code: number | null; timedOut: boolean };

const OUTPUT_MAX = 20_000;

/** 子进程环境白名单（P1 §7.5）：不透传任意进程变量，防敏感信息泄进命令输出 */
export function safeEnv(): NodeJS.ProcessEnv {
  const keys =
    process.platform === "win32"
      ? ["PATH", "SystemRoot", "SystemDrive", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "COMSPEC", "PATHEXT", "NODE_ENV"]
      : ["PATH", "HOME", "TMPDIR", "USER", "LANG", "TERM", "SHELL", "NODE_ENV"];  // NODE_ENV：Next 类型要求，无敏感信息
  const out = { NODE_ENV: process.env.NODE_ENV ?? "development" } as NodeJS.ProcessEnv;
  for (const k of keys) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

export function executeCommand(command: string, timeoutMs: number = 30_000): Promise<CommandResult> {
  const t = Math.min(120_000, Math.max(1_000, timeoutMs));
  ensureWorkspace(); // cwd 不存在会让 spawn 直接 ENOENT
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: workspaceRoot(), timeout: t, maxBuffer: 10 * 1024 * 1024, windowsHide: true, killSignal: "SIGKILL", env: safeEnv() },
      (err: Error | null, stdout: string, stderr: string) => {
        const e = err as (Error & { killed?: boolean; code?: number | string }) | null;
        const timedOut = Boolean(e?.killed);
        let out = `${stdout ?? ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;
        if (!out && e) out = String(e.message ?? e);
        out = stripAnsi(out); // 防 ANSI 转义污染 UI（P1 §7.5）
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
