"use client";

/** AI 地图体检弹窗（用户功能 A）：诊断孤立卡/重复卡/断链/缺连线，每条问题带一键修复。
 *  自己拉取体检数据；修复动作上抛给页面执行（可撤销）。 */
import { useEffect, useState } from "react";
import type { QaMapEdge, QaMapNode } from "@/lib/qaMapTypes";

type Issue = {
  type: string;
  cardIds: string[];
  description: string;
  fix?: {
    add?: Array<{ from: string; to: string; relFrom?: string; relTo?: string }>;
    remove?: string[];
    merge?: string[];
  };
};

const TYPE_LABELS: Record<string, string> = {
  isolated: "孤立卡片",
  duplicate: "重复卡片",
  missing_link: "缺少连线",
  broken_chain: "链路断裂",
};

export default function AnalyzeDialog({
  nodes,
  edges,
  onApplyEdgeOps,
  onMerge,
  onClose,
}: {
  nodes: QaMapNode[];
  edges: QaMapEdge[];
  onApplyEdgeOps: (add: NonNullable<Issue["fix"]>["add"], remove: string[]) => void;
  onMerge: (cardIds: string[]) => void;
  onClose: () => void;
}) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/qa-map/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map: { title: "", nodes, edges } }),
    })
      .then((r) => r.json())
      .then((d: { issues?: Issue[]; error?: string }) => {
        if (d.error) setErr(d.error);
        else setIssues(d.issues ?? []);
      })
      .catch(() => setErr("体检请求失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-[520px] flex-col rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">AI 地图体检</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {issues === null && !err && <p className="py-8 text-center text-[12px] text-neutral-400">正在体检…（约 10 秒）</p>}
          {err && <p className="py-8 text-center text-[12px] text-red-500">{err}</p>}
          {issues && issues.length === 0 && (
            <p className="py-8 text-center text-[12px] text-emerald-600">✓ 地图结构健康，没有发现问题</p>
          )}
          {issues && issues.length > 0 && (
            <div className="space-y-2">
              {issues.map((it, i) => {
                const fix = it.fix ?? {};
                const hasFix = (fix.add?.length ?? 0) > 0 || (fix.remove?.length ?? 0) > 0 || (fix.merge?.length ?? 0) > 0;
                return (
                  <div key={i} className="rounded-lg border border-neutral-200 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                        {TYPE_LABELS[it.type] ?? it.type}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
                        {it.cardIds.map(title).join("、")}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-5 text-neutral-700">{it.description}</p>
                    {hasFix && !applied.has(i) && (
                      <div className="mt-1.5 flex gap-2">
                        {(fix.add?.length ?? 0) + (fix.remove?.length ?? 0) > 0 && (
                          <button
                            onClick={() => {
                              onApplyEdgeOps(fix.add ?? [], fix.remove ?? []);
                              setApplied((s) => new Set(s).add(i));
                            }}
                            className="rounded border border-neutral-900 bg-neutral-900 px-2 py-0.5 text-[10.5px] text-white hover:bg-neutral-700">
                            应用连线修复
                          </button>
                        )}
                        {(fix.merge?.length ?? 0) >= 2 && (
                          <button
                            onClick={() => {
                              onMerge(fix.merge!);
                              setApplied((s) => new Set(s).add(i));
                            }}
                            className="rounded border border-emerald-600 px-2 py-0.5 text-[10.5px] text-emerald-700 hover:bg-emerald-50">
                            合并重复卡
                          </button>
                        )}
                      </div>
                    )}
                    {applied.has(i) && <div className="mt-1.5 text-[10.5px] text-emerald-600">✓ 已应用（Ctrl+Z 可撤销）</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
