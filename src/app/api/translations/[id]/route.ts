import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveTranslatedPath } from "@/lib/pdfTranslate";
import { sourcePath } from "@/lib/fileTree";
import type { AnyTranslationDoc, PdfTranslationDoc } from "@/lib/types";

export const runtime = "nodejs";

/** 译文 PDF：GET /api/translations/[id]?which=mono|dual[&download=1]
 *  新产物：译文已入库为资源（translatedSourceId）→ 从 uploads 读；
 *  旧产物：从 data/translations 相对路径取（dual 仅为兼容历史，新版不再产出）。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const which = req.nextUrl.searchParams.get("which") === "mono" ? "mono" : "dual";
  const row = db.prepare("SELECT id, title, content FROM artifacts WHERE id = ?").get(Number(id)) as
    | { id: number; title: string; content: string }
    | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let doc: AnyTranslationDoc;
  try {
    doc = JSON.parse(row.content) as AnyTranslationDoc;
  } catch {
    return NextResponse.json({ error: "产物数据损坏" }, { status: 500 });
  }
  if ((doc as { kind?: string }).kind !== "pdf") {
    return NextResponse.json({ error: "该产物不是 PDF 翻译" }, { status: 400 });
  }
  const pdf = doc as PdfTranslationDoc;

  // 新链路：译文已入库为资源
  if (pdf.translatedSourceId != null) {
    const src = db
      .prepare("SELECT filename, path FROM sources WHERE id = ?")
      .get(pdf.translatedSourceId) as { filename: string; path: string | null } | undefined;
    if (src && src.filename !== "-") {
      try {
        return streamOut(req, row, fs.readFileSync(sourcePath(src)), "mono");
      } catch {
        return NextResponse.json({ error: "译文资源文件已丢失，请重新翻译" }, { status: 404 });
      }
    }
  }
  // 旧链路：translations 目录相对路径
  const rel = which === "mono" ? pdf.monoPdf ?? pdf.dualPdf : pdf.dualPdf;
  if (!rel) return NextResponse.json({ error: "该产物没有此版本的译文" }, { status: 404 });
  const abs = resolveTranslatedPath(rel);
  if (!abs) return NextResponse.json({ error: "译文文件不存在（可能已重新翻译覆盖），请重新翻译" }, { status: 404 });
  return streamOut(req, row, fs.readFileSync(abs), which);
}

function streamOut(req: NextRequest, row: { title: string }, buffer: Buffer, which: string) {
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-cache",
      ...(download
        ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${row.title}-${which}.pdf`)}` }
        : {}),
    },
  });
}
