"use client";

/** 解答图画布：QaCanvasData → React Flow 非线性导图（树布局 + 引用跳转） */
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node as RFNode,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { QaCanvasData, QaNode, QaCite } from "@/lib/qaCanvas";

const KIND_STYLE: Record<string, { bg: string; border: string; text: string; tag: string }> = {
  question: { bg: "bg-neutral-900", border: "border-neutral-900", text: "text-white", tag: "问题" },
  approach: { bg: "bg-violet-50", border: "border-violet-300", text: "text-violet-900", tag: "思路" },
  step: { bg: "bg-white", border: "border-neutral-300", text: "text-neutral-800", tag: "步骤" },
  knowledge: { bg: "bg-sky-50", border: "border-sky-300", text: "text-sky-900", tag: "知识点" },
  pitfall: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", tag: "易错" },
  answer: { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-900", tag: "结论" },
};

type QaNodeData = { node: QaNode; onCite?: (c: QaCite) => void };
type QaRFNode = RFNode<QaNodeData, "qa">;

function QaCard({ data }: NodeProps<QaRFNode>) {
  const n = data.node;
  const st = KIND_STYLE[n.kind] ?? KIND_STYLE.step;
  return (
    <div className={`w-[250px] rounded-md border-2 ${st.border} ${st.bg} px-3 py-2 shadow-sm`}>
      <div className="flex items-center gap-1.5">
        <span className={`shrink-0 rounded-sm px-1 py-px text-[9px] font-medium ${
          n.kind === "question" ? "bg-white/20 text-white" : "bg-neutral-900/10 text-neutral-600"
        }`}>{st.tag}</span>
        <span className={`truncate text-[12px] font-semibold ${st.text}`}>{n.label}</span>
      </div>
      {n.detail && (
        <div className={`mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 ${
          n.kind === "question" ? "text-neutral-200" : "text-neutral-700"
        }`}>{n.detail.length > 220 ? n.detail.slice(0, 220) + "…" : n.detail}</div>
      )}
      {(n.cites?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {n.cites!.map((c, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                data.onCite?.(c);
              }}
              title={`跳到资料 #${c.sourceId}${c.page != null ? ` 第${c.page}页` : ""}${c.quote ? `\n"${c.quote}"` : ""}`}
              className="flex items-center gap-0.5 rounded-sm border border-neutral-300 bg-white px-1 py-px text-[9px] text-neutral-600 hover:border-neutral-500 hover:text-neutral-900"
            >
              📎 资料 #{c.sourceId}{c.page != null ? ` p${c.page}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { qa: QaCard };

/** 手写树布局：BFS 分层，每层纵向排开（无需额外布局库） */
function layout(canvas: QaCanvasData, onCite?: QaNodeData["onCite"]) {
  const children = new Map<string | null, QaNode[]>();
  for (const n of canvas.nodes) {
    children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  }
  const NODE_W = 250;
  const GAP_X = 90;
  const GAP_Y = 28;
  const heightOf = (n: QaNode) =>
    52 + Math.min(220, Math.ceil((n.detail?.length ?? 0) / 26) * 20) + ((n.cites?.length ?? 0) > 0 ? 24 : 0);

  const rfNodes: QaNode[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  type Row = { nodes: QaNode[]; depth: number };
  const rows: Row[] = [];
  const queue: { parent: string | null; depth: number }[] = [{ parent: null, depth: 0 }];
  while (queue.length) {
    const { parent, depth } = queue.shift()!;
    const kids = children.get(parent) ?? [];
    if (!kids.length) continue;
    rows[depth] ??= { nodes: [], depth };
    rows[depth].nodes.push(...kids);
    for (const k of kids) queue.push({ parent: k.id, depth: depth + 1 });
  }
  rows.forEach((row, depth) => {
    row.nodes.forEach((n, i) => {
      positions.set(n.id, { x: depth * (NODE_W + GAP_X), y: i * (110 + GAP_Y) });
    });
  });
  // 按估算高度重排 y（避免高节点重叠）
  rows.forEach((row) => {
    let y = 0;
    for (const n of row.nodes) {
      positions.set(n.id, { x: positions.get(n.id)!.x, y });
      y += heightOf(n) + GAP_Y;
    }
  });

  const flowNodes: QaRFNode[] = canvas.nodes.map((n) => ({
    id: n.id,
    type: "qa",
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: { node: n, onCite },
  }));
  const edges: Edge[] = canvas.nodes
    .filter((n) => n.parent)
    .map((n) => ({
      id: `${n.parent}-${n.id}`,
      source: n.parent!,
      target: n.id,
      type: "smoothstep",
      animated: n.kind === "answer",
    }));
  return { flowNodes, edges };
}

export default function QACanvas({
  content,
  onCite,
}: {
  content: string | QaCanvasData;
  onCite?: (c: QaCite) => void;
}) {
  const canvas = useMemo<QaCanvasData | null>(() => {
    if (typeof content !== "string") return content;
    try {
      return JSON.parse(content) as QaCanvasData;
    } catch {
      return null;
    }
  }, [content]);

  const { flowNodes, edges } = useMemo(
    () => (canvas ? layout(canvas, onCite) : { flowNodes: [], edges: [] }),
    [canvas, onCite]
  );

  if (!canvas || !canvas.nodes?.length) {
    return (
      <pre className="whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
        {typeof content === "string" ? content : "（解答图为空）"}
      </pre>
    );
  }

  return (
    <div className="h-[calc(100vh-280px)] min-h-[440px] w-full border border-neutral-200">
      <ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.15} nodesDraggable>
        <Background gap={18} size={1} color="#e5e5e5" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
