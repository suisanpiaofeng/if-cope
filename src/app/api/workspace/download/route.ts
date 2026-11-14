import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveInWorkspace, relPath, workspaceRoot } from "@/lib/agent/workspace";
import { buildZip } from "@/lib/agent/zip";

export const runtime = "nodejs";

const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;

/** 工作区下载（harness P2 §9.2）：文件直下；目录递归打包 stored zip（≤500 文件/≤20MB） */
export async function GET(req: NextRequest) {
  const rel = String(req.nextUrl.searchParams.get("path") ?? "");
  try {
    const abs = resolveInWorkspace(rel);
    if (!fs.existsSync(abs)) return NextResponse.json({ error: `路径不存在：${rel}` }, { status: 404 });

    if (fs.statSync(abs).isFile()) {
      const buf = fs.readFileSync(abs);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        },
      });
    }

    // 目录 → zip
    const entries: Array<{ path: string; content: string }> = [];
    let total = 0;
    const walk = (dirAbs: string) => {
      for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
        const childAbs = path.join(dirAbs, e.name);
        if (e.isDirectory()) {
          walk(childAbs);
        } else {
          const st = fs.statSync(childAbs);
          total += st.size;
          if (entries.length >= MAX_FILES || total > MAX_BYTES) return;
          const buf = fs.readFileSync(childAbs);
          if (buf.includes(0)) continue; // 跳过二进制（stored zip 文本场景）
          entries.push({ path: relPath(childAbs), content: buf.toString("utf8") });
        }
      }
    };
    walk(abs);
    if (entries.length >= MAX_FILES || total > MAX_BYTES) {
      return NextResponse.json({ error: "目录超出打包上限（≤500 文件/≤20MB），请分批下载" }, { status: 400 });
    }
    const zip = buildZip(entries);
    const base = path.basename(abs) || "workspace";
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.zip`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
