import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { workspaceRoot, resolveInWorkspace, relPath } from "@/lib/agent/workspace";
import { reindexByPath } from "@/lib/ingest";

export const runtime = "nodejs";

/** 工作区文件 API（harness P0 §3.3）：GET 读文件/列目录、PUT 写（expectedOld 冲突提示）、DELETE 删文件 */
export async function GET(req: NextRequest) {
  const rel = String(req.nextUrl.searchParams.get("path") ?? "");
  // raw=1：原始字节流（Univer/SheetJS 客户端解析 xlsx 等二进制）
  if (req.nextUrl.searchParams.get("raw") === "1") {
    try {
      const abs = resolveInWorkspace(rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        return NextResponse.json({ error: `路径不存在：${rel}` }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=30" },
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  try {
    const abs = resolveInWorkspace(rel);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ error: `路径不存在：${rel || "（根）"}` }, { status: 404 });
    }
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 500).map((e) => {
        const childAbs = path.join(abs, e.name);
        const st2 = e.isDirectory() ? null : fs.statSync(childAbs);
        return {
          name: e.name,
          path: relPath(childAbs),
          type: e.isDirectory() ? "dir" : "file",
          size: st2?.size,
          mtime: st2 ? Math.round(st2.mtimeMs) : undefined,
        };
      });
      return NextResponse.json({ type: "dir", path: rel, root: workspaceRoot(), entries });
    }
    const buf = fs.readFileSync(abs);
    // 二进制探测（含 NUL 字节）：P0 只支持文本预览
    if (buf.includes(0)) {
      return NextResponse.json({ type: "file", path: rel, binary: true, size: st.size, error: "二进制文件暂不支持预览" });
    }
    return NextResponse.json({
      type: "file",
      path: rel,
      content: buf.toString("utf8"),
      size: st.size,
      mtime: Math.round(st.mtimeMs),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { path?: string; content?: string; expectedOld?: string; mkdir?: boolean; base64?: boolean };
  const rel = String(body.path ?? "");
  try {
    const abs = resolveInWorkspace(rel);
    // base64 二进制写回（Univer xlsx 等编辑器保存用）
    if (body.base64) {
      const buf = Buffer.from(String(body.content ?? ""), "base64");
      fs.writeFileSync(abs, buf);
      void reindexByPath(rel.split("\\").join("/")).catch(() => {});
      return NextResponse.json({ ok: true, path: rel, size: buf.length });
    }
    const content = String(body.content ?? "");
    if (body.mkdir) {
      fs.mkdirSync(abs, { recursive: true });
      return NextResponse.json({ ok: true, path: rel, mkdir: true });
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return NextResponse.json({ error: "目标是目录，不能写入" }, { status: 400 });
    }
    // expectedOld：乐观并发——内容已被他人改过则 409 提示
    if (body.expectedOld !== undefined && fs.existsSync(abs)) {
      const cur = fs.readFileSync(abs, "utf8");
      if (cur !== body.expectedOld) {
        return NextResponse.json(
          { error: "文件已被修改（与打开时内容不一致），请刷新后重试", conflict: true, current: cur.slice(0, 2000) },
          { status: 409 }
        );
      }
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    // 编辑联动（P3-1 §2.2）：已入库文件改动后重建索引（异步不阻塞）
    void reindexByPath(rel.split("\\").join("/")).catch(() => {});
    return NextResponse.json({ ok: true, path: rel, size: content.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const rel = String(req.nextUrl.searchParams.get("path") ?? "");
  try {
    const abs = resolveInWorkspace(rel);
    if (!fs.existsSync(abs)) return NextResponse.json({ error: `路径不存在：${rel}` }, { status: 404 });
    if (fs.statSync(abs).isDirectory()) return NextResponse.json({ error: "不支持删除目录（P0）" }, { status: 400 });
    fs.rmSync(abs);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
