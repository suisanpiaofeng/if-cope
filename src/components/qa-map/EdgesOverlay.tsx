"use client";

/**
 * 关系连线覆盖层（自绘 SVG）：从 QaMapData.edges 边表渲染（纯 DAG：多入边/出边/双向共存）。
 * 目标在源右侧时 右中点→左中点；否则反向锚点（线不穿卡）。两端标注徽标挂边 id，空标注只画线。
 * 拖动卡片时随状态实时跟随；徽标可点击编辑（onEdgeClick(edgeId, end)）。
 */
import { useViewport } from "@xyflow/react";
import type { QaMapEdge, QaMapNode } from "@/lib/qaMapTypes";

const CARD_W = (n: QaMapNode) => n.w ?? 340;
const CARD_H = (n: QaMapNode) => n.h ?? 280;

export default function EdgesOverlay({
  nodes,
  edges,
  selectedEdgeId,
  onEdgeClick,
}: {
  nodes: QaMapNode[];
  edges: QaMapEdge[];
  /** 当前选中的边（两端标注独立编辑） */
  selectedEdgeId?: string | null;
  onEdgeClick?: (edgeId: string, end: "from" | "to") => void;
}) {
  const { x, y, zoom } = useViewport();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = edges.filter((e) => byId.has(e.from) && byId.has(e.to));

  if (live.length === 0) return null;

  const toScreen = (wx: number, wy: number) => ({ sx: wx * zoom + x, sy: wy * zoom + y });

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <svg className="h-full w-full">
        {live.map((e) => {
          const p = byId.get(e.from)!;
          const c = byId.get(e.to)!;
          // 锚点：目标在源右侧 → 右中点→左中点；否则反向（线不穿卡）
          const toRight = c.x > p.x;
          const a = toScreen(toRight ? p.x + CARD_W(p) : p.x, p.y + CARD_H(p) / 2);
          const b = toScreen(toRight ? c.x : c.x + CARD_W(c), c.y + CARD_H(c) / 2);
          const dx = Math.max(40, Math.abs(b.sx - a.sx) / 2);
          const d = `M ${a.sx} ${a.sy} C ${a.sx + dx} ${a.sy}, ${b.sx - dx} ${b.sy}, ${b.sx} ${b.sy}`;
          const angle = (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI;
          const sel = selectedEdgeId === e.id;
          return (
            <g key={e.id}>
              <path d={d} fill="none" stroke={sel ? "#737373" : "#d4d4d4"} strokeWidth={sel ? 2 : 1.5} />
              <polygon
                points="0,0 -9,-4.5 -9,4.5"
                fill={sel ? "#737373" : "#d4d4d4"}
                transform={`translate(${b.sx},${b.sy}) rotate(${angle})`}
              />
            </g>
          );
        })}
      </svg>

      {/* 两端标注徽标（挂边 id；空标注不渲染；截 20 字 + 悬停全文） */}
      {live.map((e) => {
        const p = byId.get(e.from)!;
        const c = byId.get(e.to)!;
        const toRight = c.x > p.x;
        const a = toScreen(toRight ? p.x + CARD_W(p) : p.x, p.y + CARD_H(p) / 2);
        const b = toScreen(toRight ? c.x : c.x + CARD_W(c), c.y + CARD_H(c) / 2);
        const badge = (t: number, end: "from" | "to", label: string | undefined, key: string) => {
          if (!label) return null;
          const isSel = selectedEdgeId === e.id;
          const sx = a.sx + (b.sx - a.sx) * t;
          const sy = a.sy + (b.sy - a.sy) * t;
          return (
            <button
              key={key}
              onClick={(ev) => {
                ev.stopPropagation();
                onEdgeClick?.(e.id, end);
              }}
              style={{ position: "absolute", left: sx, top: sy, transform: "translate(-50%, -50%)" }}
              className={`pointer-events-auto max-w-[180px] truncate rounded-sm border px-1.5 py-0.5 text-[10px] leading-3 shadow-sm transition-colors ${
                isSel
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : end === "from"
                    ? "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-900"
                    : "border-neutral-300 bg-neutral-50 text-neutral-500 hover:border-neutral-500 hover:text-neutral-900"
              }`}
              title={`${end === "from" ? "目标卡相对源卡" : "源卡相对目标卡"}的标注（点击修改）：${label}`}>
              {label.length > 20 ? `${label.slice(0, 20)}…` : label}
            </button>
          );
        };
        return [
          badge(0.2, "from", e.relFrom, `${e.id}-f`),
          badge(0.8, "to", e.relTo, `${e.id}-t`),
        ];
      })}
    </div>
  );
}
