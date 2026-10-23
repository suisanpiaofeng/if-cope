/**
 * 知识地图（对话卡片地图）：类型 + 纯函数（客户端安全）。
 * 每次问答 = 一张卡片；追问从某张卡长出新卡并连线，逐渐形成个人知识地图。
 * 持久化为 artifacts（type=qa-map，content=QaMapData JSON）。
 */

export type QaMapCite = {
  n: number;
  sourceId: number;
  title: string;
  page: number | null;
  quote: string;
};

export type QaMapNode = {
  id: string;
  parentId: string | null;
  /** 第几轮（根提问=1，追问=父轮次+1） */
  round: number;
  /** 卡片标题（取问题的简短表述） */
  title: string;
  question: string;
  /** markdown 回答 */
  answer: string;
  citations?: QaMapCite[];
  x: number;
  y: number;
  /** 卡片尺寸（可拖边框调整） */
  w?: number;
  h?: number;
  /** 与父连线的关系词（旧字段，兼容历史数据；现改为两端独立） */
  relation?: string;
  /** 连线父端徽标：子卡相对父卡的关系（单独可编辑，生成时由 AI 总结） */
  relParentEnd?: string;
  /** 连线子端徽标：父卡相对子卡的关系（单独可编辑，生成时由 AI 总结） */
  relChildEnd?: string;
};

export type QaMapData = {
  title: string;
  nodes: QaMapNode[];
};

/** 从某节点回溯祖先链（追问时带上文，保持对话连贯） */
export function ancestorChain(nodes: QaMapNode[], nodeId: string | null): QaMapNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: QaMapNode[] = [];
  let cur = nodeId ? byId.get(nodeId) : undefined;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

/** 新节点落位：追问→父卡右下方纵向堆叠；新话题→最右开新列（自动布局，免手动找空位） */
export function nextNodePosition(
  nodes: QaMapNode[],
  parentId: string | null
): { x: number; y: number } {
  if (parentId) {
    const parent = nodes.find((n) => n.id === parentId);
    if (parent) {
      const siblings = nodes.filter((n) => n.parentId === parentId);
      return { x: parent.x + (parent.w ?? 340) + 90, y: parent.y + siblings.length * 320 };
    }
  }
  if (nodes.length === 0) return { x: 60, y: 60 };
  const maxX = Math.max(...nodes.map((n) => n.x + (n.w ?? 340)));
  return { x: maxX + 90, y: 60 };
}

/** 校验并整形导入的知识地图 JSON（外部文件不可全信） */
export function normalizeQaMap(raw: unknown): QaMapData | null {
  const obj = raw as Partial<QaMapData>;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.nodes) || obj.nodes.length === 0) return null;
  const seen = new Set<string>();
  const nodes: QaMapNode[] = [];
  for (const n of obj.nodes as Array<Partial<QaMapNode>>) {
    const id = String(n.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({
      id,
      parentId: n.parentId == null ? null : String(n.parentId),
      round: Number.isFinite(Number(n.round)) && Number(n.round) > 0 ? Number(n.round) : 1,
      title: String(n.title ?? "卡片").slice(0, 40) || "卡片",
      question: String(n.question ?? ""),
      answer: String(n.answer ?? ""),
      citations: Array.isArray(n.citations)
        ? n.citations
            .filter((c) => c && Number.isFinite(Number(c.sourceId)))
            .map((c) => ({
              n: Number(c.n) || 0,
              sourceId: Number(c.sourceId),
              title: String(c.title ?? "资料").slice(0, 40),
              page: c.page == null ? null : Number(c.page),
              quote: String(c.quote ?? "").slice(0, 60),
            }))
        : undefined,
      x: Number.isFinite(Number(n.x)) ? Number(n.x) : 60,
      y: Number.isFinite(Number(n.y)) ? Number(n.y) : 60,
      w: Number.isFinite(Number(n.w)) ? Number(n.w) : 340,
      h: Number.isFinite(Number(n.h)) ? Number(n.h) : 280,
      relation: typeof n.relation === "string" && n.relation.trim() ? n.relation.trim().slice(0, 10) : undefined,
      relParentEnd: typeof n.relParentEnd === "string" && n.relParentEnd.trim() ? n.relParentEnd.trim().slice(0, 10) : undefined,
      relChildEnd: typeof n.relChildEnd === "string" && n.relChildEnd.trim() ? n.relChildEnd.trim().slice(0, 10) : undefined,
    });
  }
  // 父指向不存在的节点 → 提升为根，防图断裂
  for (const n of nodes) {
    if (n.parentId && !seen.has(n.parentId)) n.parentId = null;
  }
  return { title: String(obj.title ?? "").trim().slice(0, 60) || "导入的知识地图", nodes };
}

/** 整张地图 → markdown（导出用） */
export function qaMapToMarkdown(map: QaMapData): string {
  const byParent = new Map<string | null, QaMapNode[]>();
  for (const n of map.nodes) {
    byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  }
  const lines: string[] = [`# ${map.title}`, ""];
  const walk = (parent: string | null, depth: number) => {
    for (const n of byParent.get(parent) ?? []) {
      lines.push(`${"## ".repeat(Math.min(depth + 1, 3))}${n.title}`, "", `> ${n.question}`, "", n.answer, "");
      for (const c of n.citations ?? []) {
        lines.push(`📎 出处：${c.title} #${c.sourceId}${c.page != null ? ` 第${c.page}页` : ""}`);
      }
      lines.push("");
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}
