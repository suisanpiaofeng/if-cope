"use client";

/**
 * 关系连线覆盖层（自绘 SVG）：绕开 React Flow 边管道，用地图自己的节点坐标 +
 * useViewport 变换直接画线。拖动卡片时随状态实时跟随；两端各一个可点击的关系徽标。
 */
import { useViewport } from "@xyflow/react";
import type { QaMapNode } from "@/lib/qaMapTypes";

const CARD_W = (n: QaMapNode) => n.w ?? 340;
const CARD_H = (n: QaMapNode) => n.h ?? 280;

export default function EdgesOverlay({
  nodes,
  selectedEdgeId,
  onEdgeClick,
}: {
  nodes: QaMapNode[];
  selectedEdgeId?: string | null;
  onEdgeClick?: (childId: string) => void;
}) {
  const { x, y, zoom } = useViewport();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = nodes.filter((n) => n.parentId && byId.has(n.parentId));

  if (edges.length === 0) return null;

  const toScreen = (wx: number, wy: number) => ({ sx: wx * zoom + x, sy: wy * zoom + y });

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <svg className="h-full w-full">
        {edges.map((n) => {
          const p = byId.get(n.parentId!)!;
          // 父右中点 → 子左中点
          const a = toScreen(p.x + CARD_W(p), p.y + CARD_H(p) / 2);
          const b = toScreen(n.x, n.y + CARD_H(n) / 2);
          const dx = Math.max(40, Math.abs(b.sx - a.sx) / 2);
          const d = `M ${a.sx} ${a.sy} C ${a.sx + dx} ${a.sy}, ${b.sx - dx} ${b.sy}, ${b.sx} ${b.sy}`;
          const angle = (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI;
          const sel = selectedEdgeId === n.id;
          return (
            <g key={n.id}>
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

      {/* 两端关系徽标（点击编辑） */}
      {edges.map((n) => {
        const p = byId.get(n.parentId!)!;
        const a = toScreen(p.x + CARD_W(p), p.y + CARD_H(p) / 2);
        const b = toScreen(n.x, n.y + CARD_H(n) / 2);
        const rel = n.relation || "追问";
        const badge = (sx: number, sy: number, key: string) => (
          <button
            key={key}
            onClick={(e) => {
              e.stopPropagation();
              onEdgeClick?.(n.id);
            }}
            style={{ position: "absolute", left: sx, top: sy, transform: "translate(-50%, -50%)" }}
            className={`pointer-events-auto rounded-sm border px-1.5 py-0.5 text-[10px] leading-3 shadow-sm transition-colors ${
              selectedEdgeId === n.id
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-400 hover:text-neutral-900"
            }`}
            title="点击修改这条连线的关系词"
          >
            {rel}
          </button>
        );
        return [
          badge(a.sx + (b.sx - a.sx) * 0.2, a.sy + (b.sy - a.sy) * 0.2, `${n.id}-s`),
          badge(a.sx + (b.sx - a.sx) * 0.8, a.sy + (b.sy - a.sy) * 0.8, `${n.id}-t`),
        ];
      })}
    </div>
  );
}
