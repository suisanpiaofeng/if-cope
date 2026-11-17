/**
 * Stirling PDF 工具服务（P5 工具库改造）：
 * vendored jar（Stirling-PDF.jar）spawn 在 127.0.0.1:8080，即开即用；
 * 由 instrumentation 启动；健康探测 + 就绪等待（Spring 启动需 10~30s）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./agent/workspace";

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

/** Agent 工具后端：树内 PDF 直接走 Stirling 处理（P5）。
 *  outRel 省略时覆盖原文件（reversible 确认卡保护）；指定则另存新文件。 */
export async function runStirlingTool(
  endpoint: string, // 如 general/rotate-pdf（不带 /api/v1/ 前缀）
  pdfPath: string, // 树内相对路径
  fields: Record<string, string>, // 表单参数（pageNumbers/angle/...）
  outRel?: string
): Promise<{ savedTo: string }> {
  const { resolveInWorkspace } = await import("./agent/workspace.ts");
  const abs = resolveInWorkspace(pdfPath);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    throw new Error(`PDF 文件不存在：${pdfPath}`);
  }
  const ep = String(endpoint ?? "").replace(/^\/+|\/+$/g, "").replace(/^api\/v1\//, "");
  const form = new FormData();
  form.append("fileInput", new Blob([fs.readFileSync(abs)], { type: "application/pdf" }), path.basename(abs));
  for (const [k, v] of Object.entries(fields ?? {})) form.append(k, String(v));
  const res = await fetch(`${BASE}/api/v1/${ep}`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Stirling ${ep} 失败 HTTP ${res.status}：${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.slice(0, 5).toString().startsWith("%PDF-")) {
    throw new Error(`Stirling 返回的不是 PDF（${buf.length} bytes）——检查端点与参数`);
  }
  const target = outRel?.trim()
    ? path.join(workspaceRoot(), resolveOutRel(outRel))
    : abs; // 缺省覆盖原文件
  fs.writeFileSync(target, buf);
  return { savedTo: path.relative(workspaceRoot(), target).split("\\").join("/") };
}

function resolveOutRel(rel: string): string {
  const norm = String(rel ?? "").split("\\").join("/").replace(/^\/+/, "");
  if (!norm || norm.includes("..")) throw new Error(`输出路径非法：${rel}`);
  return norm;
}
