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
  ancestorChain,
  nextNodePosition,
  type QaMapData,
  type QaMapCite,
  type QaMapNode,
} from "@/lib/qaMapTypes";
import { webSearch, webHitsToContext, type WebHit } from "@/lib/webSearch";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `你是解题答疑助手，正在和学生进行多轮对话式学习。要求：
- 用 markdown 回答，先给结论再展开；分点清晰，公式用行内代码或 LaTeX 风格写
- 引用规则（严格遵守）：只有「资料片段」确实支撑了某个论断时，才在该论断后标注 [n]（n 为资料编号）；
  若资料与问题无关、或不足以支撑，就按通用知识干干净净地回答，**一个 [n] 都不要标**（宁缺毋滥，绝不挂无关引用）
- 若提供了「网络检索结果」：可参考其内容并直接给出链接（markdown 链接），网络来源不使用 [n] 标注；
  网络内容可能有时效性，涉及时间敏感的信息要注明“以官方最新信息为准”
- 这是地图上的一个节点：回答自成一体（读者可能只看这张卡），同时承接对话历史的脉络
- 长度适中（200-400 字为宜），突出学生能带走的结论`;

const ROUTER_SYSTEM = `你是知识地图的路由判断器。给定学生的新问题和地图里已有的卡片，判断新问题属于哪种：
- 对某张卡片的追问/直接相关延伸 → 返回那张卡片的 id
- 全新的独立话题 → 返回 null
只输出 JSON：{"parentId":"卡片id或null"}，不要输出其他文字。判断依据是问题内容的语义关联，选最相关的一张；拿不准就 null。`;

const REL_SYSTEM = `你是知识地图的关系标注器。给定相连的两张问答卡片，分别总结两个方向的关系词：
- parentEnd：子卡相对父卡的关系（如：追问延伸、深入拆解、案例验证、对比辨析、应用实践、纠错反思）
- childEnd：父卡相对子卡的关系（如：上文依据、背景来源、概念出处、前情结论、方法出处）
要求：2-6 个字的中文词，基于两问语义给出比“追问”更具体的词；拿不准时才用通用词。
只输出 JSON：{"parentEnd":"...","childEnd":"..."}`;

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
    const chain = map ? ancestorChain(map.nodes, parentId ?? null) : [];

    // ── 两端关系词：AI 总结（失败/未配模型回退默认，不阻塞主流程） ──
    let relParentEnd: string | undefined;
    let relChildEnd: string | undefined;
    if (parentId) {
      const parentQ = chain[chain.length - 1]?.question ?? "";
      const labels = await describeRelation(parentQ, q || "（图片提问）");
      relParentEnd = labels.parentEnd;
      relChildEnd = labels.childEnd;
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

    // ── 联网搜索：问题带时效性（新闻/最新/今年…）或资料为空时补参考（失败静默）。
    //    注意 retrieve 恒返回 top-k（再不相关也强制召回），不能用「hits 是否为空」判断资料命中 ──
    const looksFresh = /新闻|最新|今天|今日|现在|目前|当前|最近|近年|20\d{2}|发生了什么|谁是现任|进展|热点|实时|今日/.test(q);
    const webHits: WebHit[] = q && (looksFresh || hits.length === 0) ? await webSearch(q) : [];

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
          text: `学生提问：${q}${hits.length ? `\n\n资料片段：\n${buildContextBlocks(hits).join("\n\n")}` : "\n\n（未检索到相关资料，按通用知识回答）"}${webHits.length ? `\n\n${webHitsToContext(webHits)}` : ""}`,
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
    const cited = allCites.filter((c) => used.has(c.n));
    // 按文件（sourceId）去重：同一文件多个分块只留排名最高的一个，
    // 避免卡片下相同文件的引用芯片排排坐（显示层另有合并兑底，兼容历史数据）
    const seenSources = new Set<number>();
    const citations: QaMapCite[] = [];
    for (const c of cited) {
      if (seenSources.has(c.sourceId)) continue;
      seenSources.add(c.sourceId);
      citations.push(c);
    }

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
      relation: parentId ? "追问" : undefined,
      relParentEnd,
      relChildEnd,
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

    return NextResponse.json({ mapId: savedMapId, node, answer, citations, model, autoRouted, parentId, webUsed: webHits.length > 0 });
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

/** 两端关系词总结：为新连线生成语义化的方向标签（失败回退通用词） */
async function describeRelation(
  parentQ: string,
  childQ: string
): Promise<{ parentEnd: string; childEnd: string }> {
  const FALLBACK = { parentEnd: "追问延伸", childEnd: "上文依据" };
  const s = getSettings();
  if (!isModelConfigured(s)) return FALLBACK;
  try {
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: REL_SYSTEM },
          { role: "user", content: `父卡问题：${parentQ.slice(0, 120)}\n子卡问题：${childQ.slice(0, 120)}` },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    const text = `${msg?.content ?? ""}\n${msg?.reasoning_content ?? ""}`;
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
    const parsed = JSON.parse(json) as { parentEnd?: string; childEnd?: string };
    return {
      parentEnd: (parsed.parentEnd ?? "").trim().slice(0, 8) || FALLBACK.parentEnd,
      childEnd: (parsed.childEnd ?? "").trim().slice(0, 8) || FALLBACK.childEnd,
    };
  } catch {
    return FALLBACK;
  }
}

function mockAnswer(q: string, depth: number): string {
  return [
    `**（演示回答）** 未配置模型。你问的是：${q.slice(0, 50)}`,
    "",
    `这是地图上的第 ${depth + 1} 张卡片。配置模型后，这里会是真实的解答，并在有依据时标注资料出处 [1]。`,
  ].join("\n");
}
