import { NextRequest } from "next/server";
import { translateDocument, loadSegments } from "@/lib/translate";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 文献翻译（SSE）：逐批进度 → 完成落产物。POST { sourceId } */
export async function POST(req: NextRequest) {
  const { sourceId } = (await req.json()) as { sourceId?: number };
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: "缺少 sourceId" }), { status: 400 });
  }

  // 先做一次快速校验（资源存在、有文本），错误走普通响应
  try {
    const probe = loadSegments(id);
    if (!probe.segments.length) {
      return new Response(JSON.stringify({ error: "该资源没有可翻译的文本内容" }), { status: 400 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const { artifactId, doc } = await translateDocument(id, (done, total) =>
          send({ type: "progress", done, total })
        );
        send({ type: "done", artifactId, title: `《${doc.sourceTitle.slice(0, 30)}》翻译`, truncated: doc.truncated });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
