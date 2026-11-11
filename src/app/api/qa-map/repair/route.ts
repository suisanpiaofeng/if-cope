import { NextRequest, NextResponse } from "next/server";
import { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { resolvePrompt, PROMPT_DEFAULTS } from "@/lib/prompts";
import { extractJsonObject } from "@/lib/qaMapLink";
import { estimateTokens } from "@/lib/embed";
import type { QaMapNode } from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

/** AI 删卡智能修复（用户功能 B）：中间卡删除后建议上下游接续连线。
 *  POST { removed: QaMapNode, upstream: QaMapNode[], downstream: QaMapNode[] }
 *  → { links: [{from,to,relFrom,relTo}], summary } */
export async function POST(req: NextRequest) {
  let body: { removed?: QaMapNode; upstream?: QaMapNode[]; downstream?: QaMapNode[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const removed = body.removed;
  const up = body.upstream ?? [];
  const down = body.downstream ?? [];
  if (!removed || up.length === 0 || down.length === 0) {
    return NextResponse.json({ error: "需要 removed + upstream + downstream" }, { status: 400 });
  }
  const s = getSettings();
  if (!isModelConfigured(s)) {
    return NextResponse.json({ links: [], summary: "" }); // 无模型则不建议接续，走直接删除
  }
  const fmt = (n: QaMapNode) => `${n.id}｜${n.title}｜${n.question.slice(0, 60)}｜${n.answer.replace(/\s+/g, " ").slice(0, 80)}`;
  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: resolvePrompt("map_repair", PROMPT_DEFAULTS.map_repair) },
        {
          role: "user",
          content: `被删卡片（原本桥接上下游）：\n${fmt(removed)}\n\n上游卡：\n${up.map(fmt).join("\n")}\n\n下游卡：\n${down.map(fmt).join("\n")}`,
        },
      ],
      temperature: 0,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ links: [], summary: "" });
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
    extractJsonObject(msg?.content ?? "", "links") ?? extractJsonObject(msg?.reasoning_content ?? "", "links");
  const upIds = new Set(up.map((n) => n.id));
  const downIds = new Set(down.map((n) => n.id));
  const links: Array<{ from: string; to: string; relFrom?: string; relTo?: string }> = [];
  for (const l of (parsed?.links as Array<Record<string, unknown>> | undefined) ?? []) {
    const from = String(l.from ?? "");
    const to = String(l.to ?? "");
    if (!upIds.has(from) || !downIds.has(to) || links.length >= 3) continue;
    if (links.some((x) => x.from === from && x.to === to)) continue;
    const relFrom = String(l.relFrom ?? "").trim().slice(0, 20);
    const relTo = String(l.relTo ?? "").trim().slice(0, 20);
    links.push({ from, to, ...(relFrom ? { relFrom } : {}), ...(relTo ? { relTo } : {}) });
  }
  return NextResponse.json({ links, summary: String(parsed?.summary ?? "已接续上下游连线") });
}
