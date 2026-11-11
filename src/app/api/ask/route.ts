/**
 * 知识地图问答：问题（+追问链 +可选图片/指定资料）→ 检索资料 → markdown 回答（[n] 引用）。
 * 每次问答产出一张卡片节点，追加进地图 artifact（type=qa-map）；无图则新建。
 * 未指定父节点时由模型根据问题内容判断：挂到某张卡片（追问/相关延伸）还是新开话题。
 */
import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { retrieve, buildContextBlocks } from "@/lib/retrieval";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { resolvePrompt, PROMPT_DEFAULTS } from "@/lib/prompts";
import {
  ancestorChain,
  edgeId,
  nextNodePosition,
  normalizeQaMap,
  type QaMapData,
  type QaMapCite,
  type QaMapEdge,
  type QaMapNode,
} from "@/lib/qaMapTypes";
import { webSearch, webHitsToContext, type WebHit } from "@/lib/webSearch";

export const runtime = "nodejs";
export const maxDuration = 300;




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
        map = normalizeQaMap(JSON.parse(row.content)); // 旧格式（parentId 树）自动迁移为边表
      } catch {
        map = null;
      }
      if (!map) return NextResponse.json({ error: "地图数据损坏" }, { status: 500 });
    }

    // ── 连线：显式追问（forcedTo）> 模型判断（仅在未指定且地图非空时）──
    // 一次调用产出连线 + 两端内容型标注（map_link 合并旧路由/标注两次调用）
    let links: LinkResult[] = [];
    let autoRouted = false;
    if (typeof body.parentId === "string") {
      links = await decideLinks(q, map?.nodes ?? [], body.parentId);
    } else if (map && map.nodes.length > 0) {
      links = await decideLinks(q, map.nodes);
      autoRouted = true;
    }
    // 防御：只保留指向现存卡片的连线
    links = links.filter((l) => map?.nodes.some((n) => n.id === l.to));

    // ── 追问链上下文（全部入边祖先并集，多父全取） ──
    const chain = map ? ancestorChain(map.nodes, map.edges, links[0]?.to ?? null) : [];

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
          messages: [{ role: "system", content: resolvePrompt("ask_system", PROMPT_DEFAULTS.ask_system) }, ...history, { role: "user", content: userContent }],
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
    const sourceId = links[0]?.to ?? null;
    const pos = nextNodePosition(map?.nodes ?? [], map?.edges ?? [], sourceId);
    const linkedRounds = links.map((l) => map?.nodes.find((n) => n.id === l.to)?.round ?? 1);
    const node: QaMapNode = {
      id: `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      round: linkedRounds.length ? Math.max(...linkedRounds) + 1 : 1,
      title: (q || "图片提问").replace(/[?？。!！]\s*$/, "").slice(0, 24) || "提问",
      question: q || "（图片提问）",
      answer,
      citations: citations.length ? citations : undefined,
      x: Number.isFinite(body.x) && autoRouted === false ? Number(body.x) : pos.x,
      y: Number.isFinite(body.y) && autoRouted === false ? Number(body.y) : pos.y,
      w: 340,
      h: 280,
    };

    // ── 边落图（links → QaMapEdge，同向去重） ──
    const newEdges: QaMapEdge[] = [];
    const seenPair = new Set((map?.edges ?? []).map((e) => `${e.from}->${e.to}`));
    for (const l of links) {
      const pair = `${l.to}->${node.id}`;
      if (seenPair.has(pair)) continue;
      seenPair.add(pair);
      newEdges.push({
        id: edgeId(l.to, node.id),
        from: l.to,
        to: node.id,
        ...(l.relFrom ? { relFrom: l.relFrom } : {}),
        ...(l.relTo ? { relTo: l.relTo } : {}),
      });
    }

    let savedMapId = body.mapId ?? null;
    if (map && savedMapId != null) {
      map.nodes.push(node);
      map.edges.push(...newEdges);
      db.prepare("UPDATE artifacts SET content = ? WHERE id = ?").run(JSON.stringify(map), savedMapId);
    } else {
      const title = node.title.slice(0, 40);
      const info = db
        .prepare(
          "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'qa-map', ?, ?, ?, ?, ?)"
        )
        .run(null, title, JSON.stringify({ title, nodes: [node], edges: newEdges } as QaMapData), "[]", model, Date.now());
      savedMapId = Number(info.lastInsertRowid);
    }

    return NextResponse.json({ mapId: savedMapId, node, answer, citations, model, autoRouted, links: newEdges, webUsed: webHits.length > 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type LinkResult = { to: string; relFrom: string; relTo: string };

/** 从模型输出提取 links JSON：剥代码栅栏 → 整体解析 → 锚定 "links" 非贪婪提取。
 *  不能用贪婪 \{[\s\S]*\}——推理型模型的 reasoning 里含杂字符会拼出非法 JSON（2026-11-11 实测）。 */
function extractLinksJson(text: string): { links?: Array<{ to?: unknown; relFrom?: unknown; relTo?: unknown }> } | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* 继续尝试子串提取 */
  }
  const m = cleaned.match(/\{\s*"links"[\s\S]*?\]\s*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* 提取失败 */
    }
  }
  // 兑底：reasoning 被截断时逐个提取 link 对象（容忍尾部残缺）
  const links: Array<{ to: unknown; relFrom: unknown; relTo: unknown }> = [];
  for (const lm of cleaned.matchAll(/\{\s*"to"\s*:\s*"([^"]+)"\s*,\s*"relFrom"\s*:\s*"([^"]*)"\s*,\s*"relTo"\s*:\s*"([^"]*)"/g)) {
    links.push({ to: lm[1], relFrom: lm[2], relTo: lm[3] });
  }
  return links.length ? { links } : null;
}

const GENERIC_LABEL = /^(追问|追问延伸|延伸|相关|关联|依据|上文依据)$/;

/** 内容型标注清洗：截 20 字；纯通用词置空（不显示标注，不灌水） */
function cleanLabel(v: unknown): string {
  const t = String(v ?? "").trim().slice(0, 20);
  return GENERIC_LABEL.test(t) ? "" : t;
}

/** 一次调用：连线判断 + 两端内容型标注（替代旧 decideParent + describeRelation 两次调用）。
 *  forcedTo = 追问场景固定连线目标；links 上限 3、to 校验、温度 0；失败/未配模型时：
 *  追问场景仍建边（标注留空），新话题不乱连。 */
async function decideLinks(q: string, nodes: QaMapNode[], forcedTo?: string): Promise<LinkResult[]> {
  const FALLBACK: LinkResult[] = forcedTo ? [{ to: forcedTo, relFrom: "", relTo: "" }] : [];
  const s = getSettings();
  if (!isModelConfigured(s)) return FALLBACK;
  try {
    const cardList = nodes
      .map((n) => `${n.id}｜${n.title}｜${n.question.slice(0, 60)}｜${n.answer.replace(/\s+/g, " ").slice(0, 80)}`)
      .join("\n");
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: resolvePrompt("map_link", PROMPT_DEFAULTS.map_link) },
          {
            role: "user",
            content: `新问题：${q || "（图片提问）"}\n\n已有卡片：\n${cardList}${forcedTo ? `\n\n必须连至：${forcedTo}` : ""}`,
          },
        ],
        temperature: 0,
        max_tokens: 8000, // 推理型模型 reasoning_content 占预算且长度波动大，400/2000 都被思考吃光过（2026-11-11 实测）
      }),
    });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    const parsed =
      extractLinksJson(msg?.content ?? "") ?? extractLinksJson(msg?.reasoning_content ?? "");
    if (!parsed) {
      console.log("[map_link] JSON 解析失败 | content:", JSON.stringify(msg?.content ?? "").slice(0, 300));
      return FALLBACK;
    }
    const validIds = new Set(nodes.map((n) => n.id));
    const out: LinkResult[] = [];
    const seen = new Set<string>();
    for (const l of parsed.links ?? []) {
      const to = String(l.to ?? "");
      if (!validIds.has(to) || seen.has(to) || out.length >= 3) continue;
      if (forcedTo && to !== forcedTo) continue;
      seen.add(to);
      out.push({ to, relFrom: cleanLabel(l.relFrom), relTo: cleanLabel(l.relTo) });
    }
    return out.length ? out : FALLBACK;
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
