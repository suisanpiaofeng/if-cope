/**
 * MCP stdio 客户端（harness P2 §9.3）：
 * spawn 子进程 + 换行分隔 JSON-RPC 2.0；initialize→initialized→tools/list→tools/call；
 * 请求 30s 超时；进程死亡自愈（下次调用重连）；连接池挂 globalThis（跨路由共享，同 confirm 模式）。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { encodeMessage, parseMessages } from "./rpc.ts";
import { safeEnv } from "../agent/command.ts";

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type McpToolInfo = { name: string; description?: string; inputSchema?: unknown };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private connected = false;
  private config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return this.proc;
    const env = { ...safeEnv(), ...(this.config.env ?? {}) };
    const proc = spawn(this.config.command, this.config.args ?? [], {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = "";
    this.connected = false;
    proc.stdout.on("data", (d: Buffer) => {
      this.buffer += d.toString("utf8");
      const { msgs, rest } = parseMessages(this.buffer);
      this.buffer = rest;
      for (const m of msgs) this.handleMessage(m as Record<string, unknown>);
    });
    proc.stderr.on("data", () => {
      /* server 日志忽略（防缓冲区涨） */
    });
    proc.on("exit", () => this.cleanup(proc));
    this.proc = proc;
    return proc;
  }

  /** 进程清理（带守卫：旧进程迟到的 exit 不得误清新句柄/pending） */
  private cleanup(proc: ChildProcessWithoutNullStreams): void {
    if (this.proc !== proc) return;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("MCP server 进程退出"));
    }
    this.pending.clear();
    this.proc = null;
    this.connected = false;
  }

  private handleMessage(m: Record<string, unknown>): void {
    if (m.id === undefined || (m.result === undefined && m.error === undefined)) return;
    const p = this.pending.get(m.id as number);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(m.id as number);
    if (m.error) {
      const err = m.error as { message?: string };
      p.reject(new Error(err.message ?? "MCP 请求失败"));
    } else {
      p.resolve(m.result);
    }
  }

  private request<T>(method: string, params: unknown, timeoutMs: number = 30_000): Promise<T> {
    const proc = this.ensureProcess();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      proc.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private notify(method: string, params: unknown): void {
    this.ensureProcess().stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  /** initialize 握手（幂等：已握手的复用连接） */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ifcope", version: "1.0" },
    });
    this.notify("notifications/initialized", {});
    this.connected = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.connect();
    const r = await this.request<{ tools?: McpToolInfo[] }>("tools/list", {});
    return r.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.connect();
    const r = await this.request<{ content?: Array<{ type: string; text?: string }> }>("tools/call", {
      name,
      arguments: args ?? {},
    });
    const text = (r.content ?? [])
      .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
      .join("\n")
      .trim();
    return text || "（无文本输出）";
  }

  close(): void {
    const proc = this.proc;
    if (!proc) return;
    this.cleanup(proc); // 先同步清理（含 pending），再杀进程防迟到 exit 干扰重连
    proc.kill();
  }
}

// 连接池挂 globalThis：Next.js 各路由独立模块实例，普通 Map 不跨路由共享（同 P0 确认表教训）
const g = globalThis as { __ifcopeMcpClients?: Map<string, McpClient> };

export function getMcpClient(config: McpServerConfig): McpClient {
  const pool = g.__ifcopeMcpClients ?? (g.__ifcopeMcpClients = new Map());
  const key = `${config.name}|${config.command}|${(config.args ?? []).join(" ")}`;
  let c = pool.get(key);
  if (!c) {
    c = new McpClient(config);
    pool.set(key, c);
  }
  return c;
}
