import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { resolvePrompt, PROMPT_DEFAULTS } from "@/lib/prompts";
import { extractJsonObject } from "@/lib/qaMapLink";
import { estimateTokens } from "@/lib/embed";
import type { QaMapData } from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

/** AI 地图体检（用户功能 A）：诊断孤立卡/重复卡/断链/缺连线，输出带修复建议的报告。
 *  POST { map: QaMapData } → { issues: [...] } */
export async function POST(req: NextRequest) {
  let body: { map?: QaMapData };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const map = body.map;
  if (!map || !Array.isArray(map.nodes) || map.nodes.length === 0) {
    return NextResponse.json({ error: "缺少 map 或地图为空" }, { status: 400 });
  }
  const s = getSettings();
  if (!isModelConfigured(s)) {
    return NextResponse.json({ error: "未配置模型，无法体检" }, { status: 400 });
  }
  const cards = map.nodes
    .slice(0, 50)
    .map((n) => `${n.id}｜${n.title}｜${n.question.slice(0, 60)}｜${n.answer.replace(/\s+/g, " ").slice(0, 80)}`)
    .join("\n");
  const links = (map.edges ?? [])
    .slice(0, 80)
    .map((e) => `${e.from}->${e.to}（${e.relFrom ?? "-"}/${e.relTo ?? "-"}）`)
    .join("\n");

  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: resolvePrompt("map_analyze", PROMPT_DEFAULTS.map_analyze) },
        { role: "user", content: `卡片列表：\n${cards}\n\n连线表（from->to）：\n${links || "（无）"}` },
      ],
      temperature: 0,
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
  const parsed = extractJsonObject(msg?.content ?? "", "issues") ?? extractJsonObject(msg?.reasoning_content ?? "", "issues");
  if (!parsed) return NextResponse.json({ error: "模型输出无法解析，请重试" }, { status: 502 });
  const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 10) : [];
  return NextResponse.json({ issues, model: s.chatModel });
}

// 记录用途到 usage 汇总的 action 名统一叫 "map"（analyze/merge/repair 共用）
void db;
