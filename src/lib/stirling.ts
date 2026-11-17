/**
 * Stirling PDF 工具服务（P5 工具库改造）：
 * vendored jar（Stirling-PDF.jar）spawn 在 127.0.0.1:8080，即开即用；
 * 由 instrumentation 启动；健康探测 + 就绪等待（Spring 启动需 10~30s）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let proc: ChildProcess | null = null;
let starting = false;
let ready = false;
const PORT = 8080;
const BASE = `http://127.0.0.1:${PORT}`;

export function isStirlingRunning(): boolean {
  return proc != null && proc.exitCode === null && !proc.killed;
}

export function isStirlingReady(): boolean {
  return isStirlingRunning() && ready;
}

/** 启动（幂等；jar 不存在静默跳过——工具库页面显示未安装指引） */
export function startStirling(): void {
  if (isStirlingRunning() || starting) return;
  const jar = path.join(process.cwd(), "vendor", "Stirling-PDF.jar");
  if (!fs.existsSync(jar)) {
    console.warn("[stirling] jar 未找到（vendor/Stirling-PDF.jar），工具库跳过启动");
    return;
  }
  starting = true;
  console.log("[stirling] 启动 Stirling PDF（首次启动较慢）…");
  proc = spawn("java", ["-jar", jar, "--server.port=" + PORT], {
    env: { ...process.env, SYSTEM_ROOT: process.env.SystemRoot ?? "" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) => {
    if (String(d).includes("Started Stirling")) ready = true;
  });
  proc.stderr?.on("data", (d: Buffer) => {
    const s = String(d);
    if (s.includes("ERROR") && !ready) console.warn("[stirling]", s.slice(0, 200));
  });
  proc.on("exit", (code) => {
    console.warn(`[stirling] 进程退出 code=${code}`);
    proc = null;
    ready = false;
    starting = false;
  });
}

/** 就绪探测（10~60s 内轮询 /api/v1/info/status） */
export async function waitStirlingReady(timeoutMs = 60_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!isStirlingRunning()) return false;
    try {
      const r = await fetch(`${BASE}/api/v1/info/status`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        ready = true;
        return true;
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return ready;
}

/** 代理请求到 Stirling（工具 API / 页面） */
export async function proxyStirling(reqPath: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + reqPath, { ...init, signal: init?.signal ?? AbortSignal.timeout(120_000) });
}
