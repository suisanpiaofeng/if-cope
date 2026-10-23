import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { readFile } from "@/lib/storage";
import { filePreviewKind } from "@/lib/preview";
import { parseUrl } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp",
  pdf: "application/pdf",
};

/** 原始文件预览：
 *  图片/PDF → 流式返回原文件；
 *  md/代码/txt → UTF-8 文本；
 *  DOCX → mammoth 转 HTML；
 *  网页链接 → 实时爬取正文（失败回退已存解析文本） */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const src = db.prepare("SELECT filename, ext, source_type, url, title FROM sources WHERE id = ?").get(id) as
    | { filename: string; ext: string; source_type: string; url: string | null; title: string }
    | undefined;
  if (!src) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── 网页链接：爬取正文 ──
  if (src.source_type === "link") {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    if (!force) {
      // 默认返回已存解析文本（快）；?refresh=1 强制重新爬取
      const stored = db
        .prepare("SELECT text FROM chunks WHERE source_id = ? ORDER BY idx")
        .all(id) as Array<{ text: string }>;
      if (stored.length) {
        return NextResponse.json({ text: stored.map((r) => r.text).join("\n\n"), ext: "url", title: src.title });
      }
    }
    try {
      const { text } = await parseUrl(src.url!);
      return NextResponse.json({ text, ext: "url", title: src.title, fresh: true });
    } catch (err) {
      // 爬取失败：回退已存文本（可能本来就有）
      const stored = db
        .prepare("SELECT text FROM chunks WHERE source_id = ? ORDER BY idx")
        .all(id) as Array<{ text: string }>;
      if (stored.length) {
        return NextResponse.json({
          text: stored.map((r) => r.text).join("\n\n"), ext: "url", title: src.title,
          warning: `重新爬取失败（${err instanceof Error ? err.message : String(err)}），显示已存文本`,
        });
      }
      return NextResponse.json({ error: `爬取失败：${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
    }
  }

  if (src.source_type !== "file") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const kind = filePreviewKind(src.ext);
  if (!kind) {
    return NextResponse.json({ error: `不支持预览 .${src.ext}` }, { status: 415 });
  }

  let buffer: Buffer;
  try {
    buffer = readFile(src.filename);
  } catch {
    return NextResponse.json({ error: "原始文件已丢失" }, { status: 404 });
  }

  // 图片/PDF：直接回原始二进制，浏览器原生渲染
  if (kind === "image" || kind === "pdf") {
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME[src.ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(src.title)}.${src.ext}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // DOCX：mammoth 转语义化 HTML
  if (kind === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer });
      return NextResponse.json({ html: result.value, ext: "docx", title: src.title });
    } catch (err) {
      return NextResponse.json(
        { error: `DOCX 解析失败：${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }

  // md / 代码 / txt：返回文本，由前端渲染
  const text = buffer.toString("utf-8");
  return NextResponse.json({ text, ext: src.ext, title: src.title });
}
