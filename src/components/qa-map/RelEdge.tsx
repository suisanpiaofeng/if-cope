"use client";

/** 关系边：平滑折线 + 两端各一个关系徽标（从各自卡片视角看这条线的含义，可自定义） */
import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export type RelEdgeData = { relation?: string };

export default function RelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });
  const relation = (data as RelEdgeData | undefined)?.relation ?? "追问";

  // 两端各取路径 18% / 82% 处放徽标
  const sx = sourceX + (targetX - sourceX) * 0.18;
  const sy = sourceY + (targetY - sourceY) * 0.18;
  const tx = sourceX + (targetX - sourceX) * 0.82;
  const ty = sourceY + (targetY - sourceY) * 0.82;

  const badge = (x: number, y: number, key: string) => (
    <div
      key={key}
      style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)" }}
      className="rounded-sm border border-neutral-200 bg-white/95 px-1 py-px text-[9px] leading-3 text-neutral-500 shadow-sm"
    >
      {relation}
    </div>
  );

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={selected ? "#737373" : "#d4d4d4"}
        strokeWidth={selected ? 2 : 1.5}
      />
      {/* 箭头（目标端小三角） */}
      <polygon
        points={`${targetX},${targetY} ${targetX - 8},${targetY - 4} ${targetX - 8},${targetY + 4}`}
        fill={selected ? "#737373" : "#d4d4d4"}
        transform={`rotate(${Math.atan2(targetY - sourceY, targetX - sourceX) * (180 / Math.PI)}, ${targetX}, ${targetY})`}
      />
      <EdgeLabelRenderer>
        {badge(sx, sy, `${id}-s`)}
        {badge(tx, ty, `${id}-t`)}
      </EdgeLabelRenderer>
    </>
  );
}
