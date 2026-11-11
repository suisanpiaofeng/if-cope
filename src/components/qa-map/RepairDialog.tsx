"use client";

/** 删卡智能修复弹窗（用户功能 B）：删除中间卡时 AI 建议上下游接续连线。
 *  三种出口：删除并接续（推荐）/ 直接删除 / 取消。 */
import type { QaMapNode } from "@/lib/qaMapTypes";

export type RepairSuggestion = {
  links: Array<{ from: string; to: string; relFrom?: string; relTo?: string }>;
  summary: string;
};

export default function RepairDialog({
  node,
  upstream,
  downstream,
  suggestions,
  onConfirmRepair,
  onDeleteOnly,
  onCancel,
}: {
  node: QaMapNode;
  upstream: QaMapNode[];
  downstream: QaMapNode[];
  suggestions: RepairSuggestion | null; // null = AI 分析中
  onConfirmRepair: (links: RepairSuggestion["links"]) => void;
  onDeleteOnly: () => void;
  onCancel: () => void;
}) {
  const title = (id: string) =>
    upstream.concat(downstream).find((n) => n.id === id)?.title ?? id;
  const links = suggestions?.links ?? [];

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20" onClick={onCancel}>
      <div className="w-[460px] rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[13px] font-semibold">删除《{node.title}》</h3>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          这是一张中间卡（{upstream.length} 个上游、{downstream.length} 个下游）。
          {suggestions === null ? "AI 正在分析接续方案…" : links.length > 0 ? "删除后知识脉络会断开，建议接续：" : "删除后上下游将断开。"}
        </p>

        {suggestions !== null && links.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5">
            {links.map((l, i) => (
              <div key={i} className="text-[11px] leading-4 text-emerald-800">
                《{title(l.from)}》 → 《{title(l.to)}》
                {(l.relFrom || l.relTo) && (
                  <span className="text-emerald-600">（{l.relFrom || "?"} / {l.relTo || "?"}）</span>
                )}
              </div>
            ))}
            {suggestions.summary && (
              <div className="mt-1 text-[10px] text-emerald-600">{suggestions.summary}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50">
            取消
          </button>
          <button
            onClick={onDeleteOnly}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50">
            直接删除
          </button>
          {links.length > 0 && (
            <button
              onClick={() => onConfirmRepair(links)}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700">
              删除并接续
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
