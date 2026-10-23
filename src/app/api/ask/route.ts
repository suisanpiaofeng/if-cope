/**
 * 知识地图问答：问题（+追问链 +可选图片）→ 检索资料 → markdown 回答（[n] 引用）。
 * 每次问答产出一张卡片节点，追加进地图 artifact（type=qa-map）；无图则新建。
 */
import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage, getAigcCategoryId } from "@/lib/db";
import { retrieve, buildContextBlocks } from "@/lib/retrieval";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import {
  ancestorChain,
  type QaMapData,
  type QaMapCite,
  type QaMapNode,
} from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `你是解题答疑助手，正在和学生进行多轮对话式学习。要求：
- 用 markdown 回答，先给结论再展开；分点清晰，公式用行内代码或 LaTeX 风格写
- 关键论断后标注 [n]（n 为资料编号，对应给你的资料片段）；资料没覆盖的内容如实说明，不要编造引用
- 这是地图上的一个节点：回答自成一体（读者可能只看这张卡），同时要承接对话历史的脉络
- 长度适中（200-400 字为宜），突出学生能带走的结论`;

export async function POST(req: NextRequest) {
  const { question, mapId, parentId, x, y, image } = (await req.json()) as {
    question?: string;
    mapId?: number | null;
    parentId?: string | null;
    x?: number;
    y?: number;
    image?: string | null;
  };
  const q = (question ?? "").trim();
  if (!q && !image) return NextResponse.json({ error: "请输入问题" }, { status: 400 });

  try {
    // ── 读现有地图，构建追问链 ──
    let map: QaMapData | null = null;
    if (mapId != null) {
      const row = db.prepare("SELECT id, content FROM artifacts WHERE id = ? AND type = 'qa-map'").get(mapId) as
        | { id: number; content: string }
        | undefined;
      if (!row) return NextResponse.json({ error: "地图不存在" }, { status: 404 });
      try {
        map = JSON.parse(row.content) as QaMapData;
      } catch {
        return NextResponse.json({ error: "地图数据损坏" }, { status: 500 });
      }
    }
    const chain = map ? ancestorChain(map.nodes, parentId ?? null) : [];

    // ── 检索资料（全部可用资源；回答可标注出处） ──
    const readyIds = (db.prepare("SELECT id FROM sources WHERE status = 'ready'").all() as { id: number }[]).map(
      (r) => r.id
    );
    const hits = readyIds.length ? await retrieve(q, readyIds) : [];
    const citations: QaMapCite[] = hits.map((h) => ({
      n: h.n,
      sourceId: h.sourceId,
      title: h.title,
      page: h.page,
      quote: h.quote,
    }));

    // ── 模型回答 ──
    const s = getSettings();
    let answer: string;
    let model = "mock";
    if (!isModelConfigured(s)) {
      answer = mockAnswer(q, chain.length);
    } else {
      const history = chain.flatMap((n) => [
        { role: "user" as const, content: n.question },
        { role: "assistant" as const, content: n.answer },
      ]);
      const userContent: Array<Record<string, unknown>> = [
        {
          type: "text",
          text: `学生提问：${q}${hits.length ? `\n\n资料片段：\n${buildContextBlocks(hits).join("\n\n")}` : "\n\n（未检索到相关资料，按通用知识回答）"}`,
        },
      ];
      if (image) userContent.push({ type: "image_url", image_url: { url: image } });

      const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
        method: "POST",
        headers: modelHeaders(s.apiKey),
        body: JSON.stringify({
          model: s.chatModel,
          messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: userContent }],
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (image && (res.status === 400 || res.status === 422)) {
          throw new Error("当前模型不支持图片理解：请在设置里换视觉模型，或去掉图片用文字描述题目");
        }
        throw new Error(`模型接口错误 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ""}`);
      }
      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices: Array<{ message: { content: string } }>;
      };
      answer = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!answer) throw new Error("模型返回了空内容");
      model = s.chatModel;
      recordUsage(
        "ask", s.chatModel,
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? estimateTokens(answer)
      );
    }

    // ── 节点落图（有图追加，无图新建） ──
    const node: QaMapNode = {
      id: `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      parentId: parentId ?? null,
      round: chain.length + 1,
      title: (q || "图片提问").replace(/[?？。!！]\s*$/, "").slice(0, 24) || "提问",
      question: q || "（图片提问）",
      answer,
      citations: citations.length ? citations : undefined,
      x: Number.isFinite(x) ? Number(x) : 80,
      y: Number.isFinite(y) ? Number(y) : 80,
    };

    let savedMapId = mapId ?? null;
    if (map && savedMapId != null) {
      map.nodes.push(node);
      db.prepare("UPDATE artifacts SET content = ? WHERE id = ?").run(JSON.stringify(map), savedMapId);
    } else {
      const title = node.title.slice(0, 40);
      const info = db
        .prepare(
          "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'qa-map', ?, ?, ?, ?, ?)"
        )
        .run(getAigcCategoryId(), title, JSON.stringify({ title, nodes: [node] } as QaMapData), "[]", model, Date.now());
      savedMapId = Number(info.lastInsertRowid);
    }

    return NextResponse.json({ mapId: savedMapId, node, answer, citations, model });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function mockAnswer(q: string, depth: number): string {
  return [
    `**（演示回答）** 未配置模型。你问的是：${q.slice(0, 50)}`,
    "",
    `这是地图上的第 ${depth + 1} 张卡片。配置模型后，这里会是真实的解答，并标注资料出处 [1]。`,
    "",
    "- 要点一：结论先行",
    "- 要点二：展开推导",
  ].join("\n");
}
