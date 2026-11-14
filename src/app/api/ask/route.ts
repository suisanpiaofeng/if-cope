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
  hasCycle,
  nextNodePosition,
  normalizeQaMap,
  type QaMapData,
  type QaMapCite,
  type QaMapEdge,
  type QaMapNode,
} from "@/lib/qaMapTypes";
import { webSearch, webHitsToContext, type WebHit } from "@/lib/webSearch";
import { cleanLabel, decideLinks, type LinkResult } from "@/lib/qaMapLink";
import { skillsIndexText, SKILL_TOOL, executeLoadSkill } from "@/lib/agent/skills";
import { classifyError, friendlyError } from "@/lib/agent/errors";

export const runtime = "nodejs";
export const maxDuration = 300;




/** 地图操作工具（规格 §3：模型自主决策——整理连线 / 补充卡片 / 正常问答） */
const MAP_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_map_edges",
      description:
        "整理知识地图连线（增/删/改连线标注）。当学生要求梳理、整理、优化、重构、修改连线或关系标注时调用；调用后不再生成新卡片。",
      parameters: {
        type: "object",
        properties: {
          add: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string", description: "源卡 id" },
                to: { type: "string", description: "目标卡 id" },
                relFrom: { type: "string", description: "目标卡相对源卡的标注（内容型：类型：内容特征，可留空）" },
                relTo: { type: "string", description: "源卡相对目标卡的标注（可留空）" },
              },
              required: ["from", "to"],
            },
          },
          remove: { type: "array", items: { type: "string" }, description: "要删除的边 id（格式 from->to）" },
          summary: { type: "string", description: "本次改动的一句话说明（给学生看）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_card",
      description:
        "把新内容补充进某张已有卡片（当新问题与某张卡联系极其紧密、属于同一知识点的延伸补充时调用）；调用后不再生成新卡片。",
      parameters: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "目标卡片 id" },
          content: { type: "string", description: "补充/改写的内容（markdown）" },
          mode: { type: "string", enum: ["append", "revise"], description: "append=追加到该卡回答尾部；revise=替换整篇回答" },
          summary: { type: "string", description: "一句话说明" },
        },
        required: ["cardId", "content", "summary"],
      },
    },
  },
];

/** 地图结构摘要（供模型决策：连线/改卡/新建） */
function mapStructureText(map: QaMapData): string {
  const edges = map.edges ?? [];
  const cards = map.nodes
    .slice(0, 40)
    .map((n) => `${n.id}｜${n.title}｜${n.question.slice(0, 50)}`)
    .join("\n");
  const links = edges
    .slice(0, 60)
    .map((e) => `${e.from}->${e.to}（${e.relFrom ?? "-"}/${e.relTo ?? "-"}）`)
    .join("\n");
  return `\n\n当前地图结构（${map.nodes.length} 张卡，${edges.length} 条连线）：\n卡片：\n${cards}\n连线（from->to）：\n${links || "（无）"}\n操作说明：若学生的要求是整理/修改连线 → 调用 update_map_edges；若新内容与某张已有卡联系极其紧密、应补充进那张卡 → 调用 update_card；否则正常回答（将生成新卡片）。`;
}

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
          text: `学生提问：${q}${hits.length ? `\n\n资料片段：\n${buildContextBlocks(hits).join("\n\n")}` : "\n\n（未检索到相关资料，按通用知识回答）"}${webHits.length ? `\n\n${webHitsToContext(webHits)}` : ""}${map ? mapStructureText(map) : ""}`,
        },
      ];
      if (body.image) userContent.push({ type: "image_url", image_url: { url: body.image } });

      const mapTools = map && map.nodes.length > 0 ? MAP_TOOLS : [];
      const skillsSection = skillsIndexText();
      const activeTools = [...mapTools, ...(skillsSection ? [SKILL_TOOL] : [])];
      const reqBody: Record<string, unknown> = {
        model: s.chatModel,
        messages: [{ role: "system", content: resolvePrompt("ask_system", PROMPT_DEFAULTS.ask_system) + (skillsSection ? `\n\n${skillsSection}` : "") }, ...history, { role: "user", content: userContent }],
        temperature: s.temperature ?? 0.3,
        ...(s.maxTokens != null ? { max_tokens: s.maxTokens } : {}),
        ...(activeTools.length ? { tools: activeTools, tool_choice: "auto" } : {}),
      };
      let res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
        method: "POST",
        headers: modelHeaders(s.apiKey),
        body: JSON.stringify(reqBody),
      });
      // 上游不支持 tools 参数时降级：去掉 tools 重试一次（不支持 function calling 的模型走旧路径）
      if (!res.ok && activeTools.length && (res.status === 400 || res.status === 422)) {
        delete reqBody.tools;
        delete reqBody.tool_choice;
        res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
          method: "POST",
          headers: modelHeaders(s.apiKey),
          body: JSON.stringify(reqBody),
        });
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        if (body.image && (res.status === 400 || res.status === 422)) {
          throw new Error("当前模型不支持图片理解：请在设置里换视觉模型，或去掉图片用文字描述题目");
        }
        throw new Error(`模型接口错误 HTTP ${res.status}${errBody ? `：${errBody.slice(0, 200)}` : ""}`);
      }
      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      model = s.chatModel;
      recordUsage(
        "ask",
        s.chatModel,
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? estimateTokens(msg?.content ?? "")
      );

      // ── 地图操作工具：模型自主决策整理连线 / 补充卡片（不生成新卡） ──
      const tc = msg?.tool_calls?.[0];

      // ── 技能加载：load_skill 命中（不要求地图）→ 携正文二次请求产出最终回答（1 轮封顶，不带 tools） ──
      let answerFromSkill = "";
      if (tc && tc.function.name === "load_skill") {
        let skillArgs: Record<string, unknown> = {};
        try {
          skillArgs = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* 参数损坏走错误分支 */
        }
        let toolResult: string;
        try {
          toolResult = executeLoadSkill(skillArgs, { loadedSkills: new Set() });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toolResult = friendlyError(classifyError(msg), msg);
        }
        const toolCallId = tc.id ?? `call_${Date.now()}`;
        reqBody.messages = [
          ...(reqBody.messages as unknown[]),
          { role: "assistant", content: null, tool_calls: [{ id: toolCallId, type: "function", function: { name: "load_skill", arguments: tc.function.arguments || "{}" } }] },
          { role: "tool", tool_call_id: toolCallId, content: toolResult },
        ];
        delete reqBody.tools;
        delete reqBody.tool_choice;
        const res2 = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
          method: "POST",
          headers: modelHeaders(s.apiKey),
          body: JSON.stringify(reqBody),
        });
        if (!res2.ok) {
          const errBody = await res2.text().catch(() => "");
          throw new Error(`模型接口错误 HTTP ${res2.status}${errBody ? `：${errBody.slice(0, 200)}` : ""}`);
        }
        const data2 = (await res2.json()) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices: Array<{ message: { content: string | null } }>;
        };
        answerFromSkill = (data2.choices?.[0]?.message?.content ?? "").trim();
        recordUsage("ask", s.chatModel, data2.usage?.prompt_tokens ?? 0, data2.usage?.completion_tokens ?? estimateTokens(answerFromSkill));
        if (!answerFromSkill) throw new Error("模型返回了空内容");
      }

      if (tc && tc.function.name !== "load_skill" && map && body.mapId != null) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* 参数损坏走 fallback */
        }
        const summary = String(args.summary ?? "已按要求整理。").slice(0, 120);
        if (tc.function.name === "update_map_edges") {
          const nodeIds = new Set(map.nodes.map((n) => n.id));
          const nextEdges = [...(map.edges ?? [])];
          // remove：按边 id 删
          for (const rid of (args.remove as string[] | undefined) ?? []) {
            const i = nextEdges.findIndex((e) => e.id === String(rid));
            if (i >= 0) nextEdges.splice(i, 1);
          }
          // add：同向已存在则更新标注（兼做改标注）；防环/自环/悬空拒绝
          for (const a of (args.add as Array<Record<string, unknown>> | undefined) ?? []) {
            const from = String(a.from ?? "");
            const to = String(a.to ?? "");
            if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
            if (hasCycle(map.nodes, nextEdges, from, to)) continue;
            const relFrom = cleanLabel(a.relFrom);
            const relTo = cleanLabel(a.relTo);
            const i = nextEdges.findIndex((e) => e.from === from && e.to === to);
            if (i >= 0) {
              nextEdges[i] = {
                ...nextEdges[i],
                ...(relFrom ? { relFrom } : {}),
                ...(relTo ? { relTo } : {}),
              };
            } else {
              nextEdges.push({
                id: edgeId(from, to),
                from,
                to,
                ...(relFrom ? { relFrom } : {}),
                ...(relTo ? { relTo } : {}),
              });
            }
          }
          map.edges = nextEdges;
          db.prepare("UPDATE artifacts SET content = ? WHERE id = ?").run(JSON.stringify(map), body.mapId);
          return NextResponse.json({ mapId: body.mapId, mapUpdated: true, summary, edges: nextEdges, model, webUsed: webHits.length > 0 });
        }
        if (tc.function.name === "update_card") {
          const cardId = String(args.cardId ?? "");
          const node = map.nodes.find((n) => n.id === cardId);
          const content = String(args.content ?? "").trim();
          if (node && content) {
            node.answer = args.mode === "revise" ? content : `${node.answer}\n\n---\n\n**补充：**\n${content}`;
            db.prepare("UPDATE artifacts SET content = ? WHERE id = ?").run(JSON.stringify(map), body.mapId);
            return NextResponse.json({ mapId: body.mapId, cardUpdated: true, summary, node, model, webUsed: webHits.length > 0 });
          }
        }
        // 工具执行失败：落回正常问答（不丢回答）
      }

      answer = answerFromSkill || (msg?.content ?? "").trim();
      if (!answer) throw new Error("模型返回了空内容");
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
      db.prepare("UPDATE artifacts SET content = ? WHERE id = ?").run(JSON.stringify(map), body.mapId);
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


function mockAnswer(q: string, depth: number): string {
  return [
    `**（演示回答）** 未配置模型。你问的是：${q.slice(0, 50)}`,
    "",
    `这是地图上的第 ${depth + 1} 张卡片。配置模型后，这里会是真实的解答，并在有依据时标注资料出处 [1]。`,
  ].join("\n");
}
