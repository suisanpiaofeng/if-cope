"use client";

/** 手动连线弹窗（规格 §4）：拖线建立语义边 → 填两端标注（可留空）后确认建边。
 *  relFrom = 目标卡相对源卡（源端徽标）；relTo = 源卡相对目标卡（目标端徽标）。 */
import { useState } from "react";
import type { QaMapNode } from "@/lib/qaMapTypes";

export default function EdgeDialog({
  nodes,
  from,
  to,
  onCancel,
  onConfirm,
}: {
  nodes: QaMapNode[];
  from: string;
  to: string;
  onCancel: () => void;
  onConfirm: (relFrom: string, relTo: string) => void;
}) {
  const [relFrom, setRelFrom] = useState("");
  const [relTo, setRelTo] = useState("");
  const fromNode = nodes.find((n) => n.id === from);
  const toNode = nodes.find((n) => n.id === to);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20" onClick={onCancel}>
      <div
        className="w-[420px] rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[13px] font-semibold">建立连线</h3>
        <p className="mt-1 truncate text-[11px] text-neutral-500">
          《{fromNode?.title ?? from}》 → 《{toNode?.title ?? to}》
        </p>
        <div className="mt-3 space-y-2.5">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-neutral-600">源端标注（目标卡相对源卡）</div>
            <input
              autoFocus
              value={relFrom}
              onChange={(e) => setRelFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirm(relFrom, relTo);
                if (e.key === "Escape") onCancel();
              }}
              placeholder="如：前提：线性时不变假设（可留空）"
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] outline-none focus:border-neutral-400"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-neutral-600">目标端标注（源卡相对目标卡）</div>
            <input
              value={relTo}
              onChange={(e) => setRelTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirm(relFrom, relTo);
                if (e.key === "Escape") onCancel();
              }}
              placeholder="如：上文依据：级数展开基础（可留空）"
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] outline-none focus:border-neutral-400"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50">
            取消
          </button>
          <button
            onClick={() => onConfirm(relFrom, relTo)}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700">
            确定连线
          </button>
        </div>
      </div>
    </div>
  );
}
