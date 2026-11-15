/**
 * 知识地图（对话卡片地图）：类型 + 纯函数（客户端安全，零运行时依赖）。
 * 每次问答 = 一张卡片；卡片之间以**独立边**相连（纯 DAG：可汇聚、可分支、可兄弟/双向连线，
 * 规格 docs/superpowers/specs/2026-11-10-qa-map-graph-redesign.md）。
 * 持久化为 artifacts（type=qa-map，content=QaMapData JSON）。
 * 旧格式（节点带 parentId 的树）导入时自动迁移为边表。
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
  /** 第几轮（根提问=1，追问=所连卡轮次+1） */
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
};

/** 边（语义连线）：平等无主父；同向唯一、反向允许。
 *  relFrom = 目标卡相对源卡的关系（显示在源端）；relTo = 源卡相对目标卡（显示在目标端）。 */
export type QaMapEdge = {
  id: string;
  from: string;
  to: string;
  relFrom?: string;
  relTo?: string;
};

export type QaMapData = {
  title: string;
  nodes: QaMapNode[];
  edges: QaMapEdge[];
  /** 检索范围（P4 定稿 §〇）：多选项目 id；空=不限；地图全局无归属 */
  projectScope?: number[];
};

/** 边 id：同向稳定唯一 */
export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

function cleanLabel(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 40) : undefined;
}

/** 从某节点沿全部入边并集向上收集祖先（多父全取、去重、不含自身）。
 *  按 round 升序输出（根/旧在前、直接父在尾）；超过 8 条取最近 8 个（round 较新优先）。 */
export function ancestorChain(nodes: QaMapNode[], edges: QaMapEdge[], nodeId: string | null): QaMapNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeId || !byId.has(nodeId)) return [];
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  }
  const visited = new Set<string>([nodeId]);
  const found: QaMapNode[] = [];
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const pid of incoming.get(cur) ?? []) {
      if (visited.has(pid)) continue;
      visited.add(pid);
      const p = byId.get(pid);
      if (p) found.push(p);
      queue.push(pid);
    }
  }
  found.sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  return found.length > 8 ? found.slice(-8) : found;
}

/** 新节点落位：连线源右下方按出边数纵向堆叠；无源最右开新列（自动布局，免手动找空位） */
export function nextNodePosition(
  nodes: QaMapNode[],
  edges: QaMapEdge[],
  sourceId: string | null
): { x: number; y: number } {
  if (sourceId) {
    const source = nodes.find((n) => n.id === sourceId);
    if (source) {
      const outCount = edges.filter((e) => e.from === sourceId).length;
      return { x: source.x + (source.w ?? 340) + 90, y: source.y + outCount * 320 };
    }
  }
  if (nodes.length === 0) return { x: 60, y: 60 };
  const maxX = Math.max(...nodes.map((n) => n.x + (n.w ?? 340)));
  return { x: maxX + 90, y: 60 };
}

/** 加 from→to 后是否成环（自 to 沿出边可达 from 即成环；自环也拒绝） */
export function hasCycle(nodes: QaMapNode[], edges: QaMapEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const byId = new Set(nodes.map((n) => n.id));
  if (!byId.has(from) || !byId.has(to)) return false;
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const seen = new Set<string>([to]);
  const queue = [to];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === from) return true;
    for (const nxt of out.get(cur) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        queue.push(nxt);
      }
    }
  }
  return false;
}

/** 校验并整形导入的知识地图 JSON（外部文件不可全信）。
 *  双格式：旧格式（节点带 parentId、无 edges）自动迁移为边；新格式校验边（去重/丢悬空/改名冲突 id）。 */
export function normalizeQaMap(raw: unknown): QaMapData | null {
  const obj = raw as Partial<QaMapData> & { nodes?: unknown[] };
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.nodes) || obj.nodes.length === 0) return null;

  // ── 节点清洗（一律剥掉旧字段；旧字段先留给迁移用） ──
  const seen = new Set<string>();
  const nodes: QaMapNode[] = [];
  const legacy = new Map<string, { parentId?: string; relation?: string; relParentEnd?: string; relChildEnd?: string }>();
  for (const raw2 of obj.nodes as Array<Record<string, unknown>>) {
    const id = String(raw2?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const parentId = raw2.parentId == null ? null : String(raw2.parentId);
    if (parentId !== null || "relation" in raw2 || "relParentEnd" in raw2 || "relChildEnd" in raw2) {
      legacy.set(id, {
        parentId: parentId ?? undefined,
        relation: typeof raw2.relation === "string" ? raw2.relation : undefined,
        relParentEnd: typeof raw2.relParentEnd === "string" ? raw2.relParentEnd : undefined,
        relChildEnd: typeof raw2.relChildEnd === "string" ? raw2.relChildEnd : undefined,
      });
    }
    nodes.push({
      id,
      round: Number.isFinite(Number(raw2.round)) && Number(raw2.round) > 0 ? Number(raw2.round) : 1,
      title: String(raw2.title ?? "卡片").slice(0, 40) || "卡片",
      question: String(raw2.question ?? ""),
      answer: String(raw2.answer ?? ""),
      citations: Array.isArray(raw2.citations)
        ? (raw2.citations as unknown[])
            .filter((c) => c && Number.isFinite(Number((c as { sourceId?: unknown }).sourceId)))
            .map((c) => {
              const cc = c as Record<string, unknown>;
              return {
                n: Number(cc.n) || 0,
                sourceId: Number(cc.sourceId),
                title: String(cc.title ?? "资料").slice(0, 40),
                page: cc.page == null ? null : Number(cc.page),
                quote: String(cc.quote ?? "").slice(0, 60),
              };
            })
        : undefined,
      x: Number.isFinite(Number(raw2.x)) ? Number(raw2.x) : 60,
      y: Number.isFinite(Number(raw2.y)) ? Number(raw2.y) : 60,
      w: Number.isFinite(Number(raw2.w)) ? Number(raw2.w) : 340,
      h: Number.isFinite(Number(raw2.h)) ? Number(raw2.h) : 280,
    });
  }

  // ── 边：旧格式迁移 / 新格式校验 ──
  const edges: QaMapEdge[] = [];
  const seenPair = new Set<string>();
  const seenEdgeId = new Set<string>();
  const push = (from: string, to: string, relFrom?: string, relTo?: string, id?: string) => {
    if (!seen.has(from) || !seen.has(to) || from === to) return; // 悬空/自环丢弃
    const pair = edgeId(from, to);
    if (seenPair.has(pair)) return; // 同向去重（反向保留）
    seenPair.add(pair);
    let eid = (id ?? "").trim() || pair;
    if (seenEdgeId.has(eid)) eid = pair; // id 冲突自动改名
    if (seenEdgeId.has(eid)) return;
    seenEdgeId.add(eid);
    edges.push({ id: eid, from, to, ...(relFrom ? { relFrom } : {}), ...(relTo ? { relTo } : {}) });
  };

  if (!Array.isArray(obj.edges)) {
    // 旧格式（树）：parentId → 边；标注 relParentEnd→relFrom、relChildEnd→relTo（relation 兜底 relFrom）
    for (const n of nodes) {
      const lg = legacy.get(n.id);
      if (lg?.parentId) {
        push(lg.parentId, n.id, cleanLabel(lg.relParentEnd ?? lg.relation), cleanLabel(lg.relChildEnd));
      }
    }
  } else {
    for (const e of obj.edges as Array<Record<string, unknown>>) {
      const from = String(e?.from ?? "").trim();
      const to = String(e?.to ?? "").trim();
      push(from, to, cleanLabel(e.relFrom), cleanLabel(e.relTo), String(e.id ?? ""));
    }
  }

  return {
    title: String(obj.title ?? "").trim().slice(0, 60) || "导入的知识地图",
    nodes,
    edges,
    projectScope: Array.isArray(obj.projectScope) ? obj.projectScope.map(Number).filter((n) => Number.isInteger(n)) : undefined,
  };
}

/** 整张地图 → markdown（导出用）：每节点取第一条入边为树边做缩进，其余入边以「关联至」附注 */
export function qaMapToMarkdown(map: QaMapData): string {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const treeParent = new Map<string, QaMapEdge>();
  for (const e of map.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (!treeParent.has(e.to)) treeParent.set(e.to, e);
  }
  const children = new Map<string, QaMapNode[]>();
  const roots: QaMapNode[] = [];
  for (const n of map.nodes) {
    const pe = treeParent.get(n.id);
    if (pe) children.set(pe.from, [...(children.get(pe.from) ?? []), n]);
    else roots.push(n);
  }
  const extra = new Map<string, QaMapEdge[]>();
  for (const e of map.edges) {
    if (treeParent.get(e.to)?.id !== e.id) extra.set(e.from, [...(extra.get(e.from) ?? []), e]);
  }

  const lines: string[] = [`# ${map.title}`, ""];
  const visited = new Set<string>();
  const walk = (node: QaMapNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const pe = treeParent.get(node.id);
    lines.push(`${"## ".repeat(Math.min(depth + 1, 3))}${node.title}`, "");
    if (pe?.relFrom || pe?.relTo) {
      lines.push(`> 连线：${pe.relFrom ?? "?"} / ${pe.relTo ?? "?"}`, "");
    }
    lines.push(`> ${node.question}`, "", node.answer, "");
    for (const c of node.citations ?? []) {
      lines.push(`📎 出处：${c.title} #${c.sourceId}${c.page != null ? ` 第${c.page}页` : ""}`);
    }
    for (const e of extra.get(node.id) ?? []) {
      const t = byId.get(e.to);
      if (t) lines.push(`→ 关联至《${t.title}》${e.relFrom ? `（${e.relFrom}）` : ""}`);
    }
    lines.push("");
    for (const c of children.get(node.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const n of map.nodes) walk(n, 0); // 兜底：环/断链也不丢卡
  return lines.join("\n");
}

/** 一键自动布局（分层）：按连线关系分层排列——根在左、子层向右、同层按原 y 保序。
 *  纯函数不改入参；节点尺寸保留。孤立节点归根层排尾部。 */
export function autoLayout(
  nodes: QaMapNode[],
  edges: QaMapEdge[],
  opts?: { gapX?: number; gapY?: number }
): QaMapNode[] {
  const gapX = opts?.gapX ?? 90;
  const gapY = opts?.gapY ?? 40;
  if (nodes.length === 0) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  }
  // 层号 = 沿入边的最长路径（根=0）；有环时用迭代松弛防死循环
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const n of nodes) {
      const parents = incoming.get(n.id) ?? [];
      const d = parents.length ? Math.max(...parents.map((p) => (depth.get(p) ?? 0) + 1)) : 0;
      if (d !== depth.get(n.id)) {
        depth.set(n.id, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 分层并按原 y 保序
  const layers = new Map<number, QaMapNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    layers.set(d, [...(layers.get(d) ?? []), n]);
  }
  const maxW = Math.max(...nodes.map((n) => n.w ?? 340));
  const maxH = Math.max(...nodes.map((n) => n.h ?? 280));
  const out: QaMapNode[] = [];
  for (const [d, layer] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    layer.sort((a, b) => a.y - b.y);
    const totalH = layer.length * (maxH + gapY) - gapY;
    layer.forEach((n, i) => {
      out.push({
        ...n,
        x: d * (maxW + gapX),
        y: i * (maxH + gapY) - totalH / 2 + maxH / 2,
      });
    });
  }
  return out;
}
