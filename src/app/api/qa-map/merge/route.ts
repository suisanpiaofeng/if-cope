import { NextRequest, NextResponse } from "next/server";
import { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { resolvePrompt, PROMPT_DEFAULTS } from "@/lib/prompts";
import { extractJsonObject } from "@/lib/qaMapLink";
import { estimateTokens } from "@/lib/embed";
import type { QaMapNode } from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

/** AI 重复卡合并（用户功能 D）：N 张卡融合成一张。
 *  POST { cards: QaMapNode[] } → { title, question, answer, summary } */
export async function POST(req: NextRequest) {
  let body: { cards?: QaMapNode[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const cards = (body.cards ?? []).filter((c) => c && c.id != null);
  if (cards.length < 2) {
    return NextResponse.json({ error: "至少需要 2 张卡片才能合并" }, { status: 400 });
  }
  const s = getSettings();
  if (!isModelConfigured(s)) {
    return NextResponse.json({ error: "未配置模型，无法合并" }, { status: 400 });
  }
  const material = cards
    .map((n, i) => `【卡${i + 1}】id=${n.id}\n标题：${n.title}\n问题：${n.question}\n回答：${n.answer}`)
    .join("\n\n");

  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: resolvePrompt("map_merge", PROMPT_DEFAULTS.map_merge) },
        { role: "user", content: `待融合的卡片：\n\n${material}` },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `模型接口错误 HTTP ${res.status}` }, { status: 502 });
  }
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
  };
  const msg = data.choices?.[0]?.message;
  recordUsage(
    "map",
    s.chatModel,
    data.usage?.prompt_tokens ?? 0,
    data.usage?.completion_tokens ?? estimateTokens(msg?.content ?? "")
  );
  const parsed =
    extractJsonObject(msg?.content ?? "", "answer") ?? extractJsonObject(msg?.reasoning_content ?? "", "answer");
  if (!parsed || typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    return NextResponse.json({ error: "模型输出无法解析，请重试" }, { status: 502 });
  }
  return NextResponse.json({
    title: String(parsed.title ?? cards[0].title).slice(0, 20),
    question: String(parsed.question ?? cards[0].question),
    answer: String(parsed.answer),
    summary: String(parsed.summary ?? "已合并多张卡片"),
  });
}
