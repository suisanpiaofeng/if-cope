import { NextRequest, NextResponse } from "next/server";
import db, { getAigcCategoryId } from "@/lib/db";
import { generateQaCanvas, qaCanvasToMarkdown } from "@/lib/qaCanvas";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 解题答疑：问题（+可选图片）→ 结构化解答图 JSON → 存为产物（type=qa-canvas） */
export async function POST(req: NextRequest) {
  const { question, sourceIds, image } = (await req.json()) as {
    question?: string;
    sourceIds?: number[];
    image?: string | null;
  };
  const q = (question ?? "").trim();
  if (!q && !image) return NextResponse.json({ error: "请输入问题或上传题目图片" }, { status: 400 });

  try {
    const { canvas, model } = await generateQaCanvas(q, sourceIds ?? [], image ?? null);
    const title = canvas.title.slice(0, 60);
    const info = db
      .prepare(
        "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'qa-canvas', ?, ?, ?, ?, ?)"
      )
      .run(
        getAigcCategoryId(),
        title,
        JSON.stringify(canvas),
        JSON.stringify(sourceIds ?? []),
        model,
        Date.now()
      );
    return NextResponse.json({
      artifactId: Number(info.lastInsertRowid),
      canvas,
      markdown: qaCanvasToMarkdown(canvas),
      model,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
