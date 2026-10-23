import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveTranslatedPath } from "@/lib/pdfTranslate";
import type { AnyTranslationDoc } from "@/lib/types";

export const runtime = "nodejs";

/** 译文 PDF 流式：GET /api/translations/[id]?which=dual|mono[&download=1] */
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
  const pdf = doc as { dualPdf: string; monoPdf?: string };
  const rel = which === "mono" ? pdf.monoPdf ?? pdf.dualPdf : pdf.dualPdf;
  const abs = resolveTranslatedPath(rel);
  if (!abs) return NextResponse.json({ error: "译文文件不存在（可能已重新翻译覆盖），请在左侧历史重开或重新翻译" }, { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(stat.size),
      "Cache-Control": "no-cache",
      ...(download
        ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${row.title}-${which}.pdf`)}` }
        : {}),
    },
  });
}
