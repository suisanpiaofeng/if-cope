import { NextRequest, NextResponse } from "next/server";
import { decideLinks } from "@/lib/qaMapLink";
import type { QaMapNode } from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 手动连线时标注留空 → AI 补生成两端标注（复用 map_link 的标注能力）。
 *  POST { from: {id,question,answer}, to: {id,question,answer} } → { relFrom, relTo } */
export async function POST(req: NextRequest) {
  let body: { from?: Partial<QaMapNode>; to?: Partial<QaMapNode> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const mk = (n: Partial<QaMapNode> | undefined): QaMapNode | null => {
    if (!n || n.id == null || n.question == null) return null;
    return {
      id: String(n.id),
      round: Number(n.round) || 1,
      title: String(n.title ?? "卡片"),
      question: String(n.question),
      answer: String(n.answer ?? ""),
      x: 0,
      y: 0,
    };
  };
  const from = mk(body.from);
  const to = mk(body.to);
  if (!from || !to) return NextResponse.json({ error: "from/to 需含 id 与 question" }, { status: 400 });

  // 语义：手动边 from→to；relFrom = to 相对 from（from 侧徽标），relTo = from 相对 to（to 侧徽标）。
  // decideLinks 的 forcedTo 语义产出的 relFrom/relTo 正好同构。
  const links = await decideLinks(to.question, [from, to], from.id);
  const l = links.find((x) => x.to === from.id);
  return NextResponse.json({ relFrom: l?.relFrom ?? "", relTo: l?.relTo ?? "" });
}
