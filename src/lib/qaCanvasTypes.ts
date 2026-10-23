/**
 * 解答图：类型 + 纯函数（客户端安全，零服务端依赖）。
 * 生成逻辑（走模型）在 lib/qaCanvas.ts，渲染/导出等客户端代码只依赖本文件。
 */

export type QaCite = { sourceId: number; page: number | null; quote: string };

export type QaNodeKind = "question" | "approach" | "step" | "knowledge" | "pitfall" | "answer";

export type QaNode = {
  id: string;
  parent: string | null;
  kind: QaNodeKind;
  label: string;
  detail: string;
  cites?: QaCite[];
};

export type QaCanvasData = { title: string; nodes: QaNode[] };

export const QA_NODE_KINDS: QaNodeKind[] = ["question", "approach", "step", "knowledge", "pitfall", "answer"];

/** 校验并整形模型输出（模型输出不可全信） */
export function normalizeQaCanvas(raw: unknown): QaCanvasData | null {
  const obj = raw as Partial<QaCanvasData>;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.nodes) || obj.nodes.length === 0) return null;
  const seen = new Set<string>();
  const nodes: QaNode[] = [];
  for (const n of obj.nodes as Array<Partial<QaNode>>) {
    const id = String(n.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind: QaNodeKind = QA_NODE_KINDS.includes(n.kind as QaNodeKind) ? (n.kind as QaNodeKind) : "step";
    const cites = Array.isArray(n.cites)
      ? n.cites
          .filter((c) => c && Number.isFinite(Number(c.sourceId)))
          .map((c) => ({
            sourceId: Number(c.sourceId),
            page: c.page == null ? null : Number(c.page),
            quote: String(c.quote ?? "").slice(0, 60),
          }))
      : undefined;
    nodes.push({
      id,
      parent: n.parent == null ? null : String(n.parent),
      kind,
      label: String(n.label ?? "").slice(0, 30) || "节点",
      detail: String(n.detail ?? ""),
      cites: cites && cites.length ? cites : undefined,
    });
  }
  // 父指向不存在的节点 → 提升为根，防止图断裂
  for (const n of nodes) {
    if (n.parent && !seen.has(n.parent)) n.parent = null;
  }
  if (!nodes.some((n) => n.kind === "question")) {
    nodes[0] = { ...nodes[0], kind: "question", parent: null };
  }
  return { title: String(obj.title ?? "").trim() || "解答", nodes };
}

/** 解答图 → markdown（下载/存档用） */
export function qaCanvasToMarkdown(canvas: QaCanvasData): string {
  const byParent = new Map<string | null, QaNode[]>();
  for (const n of canvas.nodes) {
    byParent.set(n.parent, [...(byParent.get(n.parent) ?? []), n]);
  }
  const lines: string[] = [`# ${canvas.title}`, ""];
  const walk = (parent: string | null, depth: number) => {
    for (const n of byParent.get(parent) ?? []) {
      lines.push(`${"  ".repeat(depth)}- **${n.label}**${n.detail ? `：${n.detail}` : ""}`);
      for (const c of n.cites ?? []) {
        lines.push(`${"  ".repeat(depth)}  - 📎 出处：资料 #${c.sourceId}${c.page != null ? ` 第${c.page}页` : ""}${c.quote ? `（"${c.quote}"）` : ""}`);
      }
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}
