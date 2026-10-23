import { NextRequest, NextResponse } from "next/server";
import { runPdf2zh } from "@/lib/pdfTranslate";

export const runtime = "nodejs";
export const maxDuration = 300;

/** PDF 保真翻译（pdf2zh）：同步等待产出（小文档约 1 分钟），POST { sourceId } */
export async function POST(req: NextRequest) {
  const { sourceId } = (await req.json()) as { sourceId?: number };
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "缺少 sourceId" }, { status: 400 });
  }
  try {
    const { artifactId, doc } = await runPdf2zh(id);
    return NextResponse.json({ artifactId, doc });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
