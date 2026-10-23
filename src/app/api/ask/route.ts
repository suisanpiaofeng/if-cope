/**
 * 知识地图问答：问题（+追问链 +可选图片/指定资料）→ 检索资料 → markdown 回答（[n] 引用）。
 * 每次问答产出一张卡片节点，追加进地图 artifact（type=qa-map）；无图则新建。
 * 未指定父节点时由模型根据问题内容判断：挂到某张卡片（追问/相关延伸）还是新开话题。
 */
import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage, getAigcCategoryId } from "@/lib/db";
import { retrieve, buildContextBlocks } from "@/lib/retrieval";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import {
  nextNodePosition,
  type QaMapData,
  type QaMapCite,
  type QaMapNode,
} from "@/lib/qaMapTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `你是解题答疑助手，正在和学生进行多轮对话式学习。要求：
- 用 markdown 回答，先给结论再展开；分点清晰，公式用行内代码或 LaTeX 风格写
- 引用规则（严格遵守）：只有资料片段确实支撑了某个论断时，才在该论断后标注 [n]（n 为资料编号）；
  若资料与问题无关、或不足以支撑，就按通用知识干干净净地回答，**一个 [n] 都不要标**（宁缺毋滥，绝不挂无关引用）
- 这是地图上的一个节点：回答自成一体（读者可能只看这张卡），同时承接对话历史的脉络
- 长度适中（200-400 字为宜），突出学生能带走的结论`;

const ROUTER_SYSTEM = `你是知识地图的路由判断器。给定学生的新问题和地图里已有的卡片，判断新问题属于哪种：
- 对某张卡片的追问/直接相关延伸 → 返回那张卡片的 id
- 全新的独立话题 → 返回 null
只输出 JSON：{"parentId":"卡片id或null"}，不要输出其他文字。判断依据是问题内容的语义关联，选最相关的一张；拿不准就 null。`;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    question?: string;
    mapId?: number | null;
    /** 指定父卡片（卡片上「从这里追问」）；缺省 = 自动判断 */
    parentId?: string | null;
    sourceIds?: number[];
    x?: number;
    y?: number;
    image?: string | null;
  };
  const q = (body.question ?? "").trim();
  if (!q && !body.image) return NextResponse.json({ error: "请输入问题" }, { status: 400 });

  try {
    // ── 读现有地图 ──
    let map: QaMapData | null = null;
    if (body.mapId != null) {
      const row = db.prepare("SELECT id, content FROM artifacts WHERE id = ? AND type = 'qa-map'").get(body.mapId) as
        | { id: number; content: string }
        | undefined;
      if (!row) return NextResponse.json({ error: "地图不存在" }, { status: 404 });
      try {
        map = JSON.parse(row.content) as QaMapData;
      } catch {
        return NextResponse.json({ error: "地图数据损坏" }, { status: 500 });
      }
    }

    // ── 父节点：显式指定 > 模型判断（仅在未指定且地图非空时） ──
    let parentId: string | null = null;
    let autoRouted = false;
    if (typeof body.parentId === "string") {
      parentId = body.parentId;
    } else if (map && map.nodes.length > 0) {
      parentId = await decideParent(q, map.nodes);
      autoRouted = true;
    }

    // ── 追问链上下文 ──
    const byId = new Map((map?.nodes ?? []).map((n) => [n.id, n]));
    const chain: QaMapNode[] = [];
    let cur = parentId ? byId.get(parentId) : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }

    // ── 检索资料（指定资源优先；否则全部可用） ──
    const readyIds = (db.prepare("SELECT id FROM sources WHERE status = 'ready'").all() as { id: number }[]).map(
      (r) => r.id
    );
    const scope = (body.sourceIds ?? []).filter((id) => readyIds.includes(id));
    const searchIds = scope.length ? scope : readyIds;
    const hits = searchIds.length ? await retrieve(q, searchIds) : [];
    const allCites: QaMapCite[] = hits.map((h) => ({
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
      if (body.image) userContent.push({ type: "image_url", image_url: { url: body.image } });

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
        const errBody = await res.text().catch(() => "");
        if (body.image && (res.status === 400 || res.status === 422)) {
          throw new Error("当前模型不支持图片理解：请在设置里换视觉模型，或去掉图片用文字描述题目");
        }
        throw new Error(`模型接口错误 HTTP ${res.status}${errBody ? `：${errBody.slice(0, 200)}` : ""}`);
      }
      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices: Array<{ message: { content: string } }>;
      };
      answer = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!answer) throw new Error("模型返回了空内容");
      model = s.chatModel;
      recordUsage("ask", s.chatModel, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? estimateTokens(answer));
    }

    // ── 引用过滤：只保留回答里真正用 [n] 标注过的出处，一个没标就零引用 ──
    const used = new Set(
      [...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))
    );
    const citations = allCites.filter((c) => used.has(c.n));

    // ── 节点落图 ──
    const pos = nextNodePosition(map?.nodes ?? [], parentId);
    const node: QaMapNode = {
      id: `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      parentId,
      round: chain.length + 1,
      title: (q || "图片提问").replace(/[?？。!！]\s*$/, "").slice(0, 24) || "提问",
      question: q || "（图片提问）",
      answer,
      citations: citations.length ? citations : undefined,
      x: Number.isFinite(body.x) && autoRouted === false ? Number(body.x) : pos.x,
      y: Number.isFinite(body.y) && autoRouted === false ? Number(body.y) : pos.y,
      w: 340,
      h: 280,
    };

    let savedMapId = body.mapId ?? null;
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

    return NextResponse.json({ mapId: savedMapId, node, answer, citations, model, autoRouted, parentId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** 模型路由：追问哪张卡还是新话题；失败/未配模型时一律新话题（不乱连） */
async function decideParent(question: string, nodes: QaMapNode[]): Promise<string | null> {
  const s = getSettings();
  if (!isModelConfigured(s) || !question.trim()) return null;
  const list = nodes.map((n) => `- id=${n.id}｜${n.title}`).join("\n");
  try {
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: ROUTER_SYSTEM },
          { role: "user", content: `新问题：${question}\n\n已有卡片：\n${list}` },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
    };
    // 思考型模型可能把预算花在 reasoning_content 上，合并两者找 JSON
    const msg = data.choices?.[0]?.message;
    const text = `${msg?.content ?? ""}\n${msg?.reasoning_content ?? ""}`;
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
    if (!json) return null;
    const parsed = JSON.parse(json) as { parentId?: string | number | null };
    const pid = parsed.parentId == null ? null : String(parsed.parentId);
    return pid && nodes.some((n) => n.id === pid) ? pid : null;
  } catch {
    return null;
  }
}

function mockAnswer(q: string, depth: number): string {
  return [
    `**（演示回答）** 未配置模型。你问的是：${q.slice(0, 50)}`,
    "",
    `这是地图上的第 ${depth + 1} 张卡片。配置模型后，这里会是真实的解答，并在有依据时标注资料出处 [1]。`,
  ].join("\n");
}
