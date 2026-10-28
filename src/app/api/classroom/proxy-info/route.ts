import { NextResponse } from "next/server";
import net from "node:net";
import { PORT } from "@/lib/classroom/cookieRewrite";

/** 反代状态：GET /api/classroom/proxy-info（规格 §4）。
 *  直接探测端口而非读模块状态——Next 的 instrumentation 与 API route 是不同打包入口，
 *  模块实例不共享，内存标志在 route 侧读不到。 */
async function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(800, () => done(false));
    sock.on("connect", () => done(true));
    sock.on("error", () => done(false));
  });
}

export async function GET() {
  return NextResponse.json({ running: await probePort(PORT), port: PORT });
}
