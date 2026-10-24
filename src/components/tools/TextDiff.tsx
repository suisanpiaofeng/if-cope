"use client";

/** 文本 Diff：逐行 LCS 对比，高亮增/删/改，支持忽略大小写/空白 */
import { useMemo, useState } from "react";
import { Area, Btn } from "./_ui";

type Row = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

function diffLines(a: string, b: string, ignoreWs: boolean, ignoreCase: boolean): Row[] {
  const norm = (s: string) => {
    let x = s;
    if (ignoreWs) x = x.replace(/\s+/g, " ").trim();
    if (ignoreCase) x = x.toLowerCase();
    return x;
  };
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  // LCS DP
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: Row[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (norm(A[i]) === norm(B[j])) { rows.push({ type: "same", text: A[i], a: i, b: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: A[i], a: i }); i++; }
    else { rows.push({ type: "add", text: B[j], b: j }); j++; }
  }
  while (i < n) rows.push({ type: "del", text: A[i], a: i++ });
  while (j < m) rows.push({ type: "add", text: B[j], b: j++ });
  return rows;
}

export default function TextDiff() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);

  const rows = useMemo(() => (a || b ? diffLines(a, b, ignoreWs, ignoreCase) : []), [a, b, ignoreWs, ignoreCase]);
  const adds = rows.filter((r) => r.type === "add").length;
  const dels = rows.filter((r) => r.type === "del").length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={ignoreWs} onChange={() => setIgnoreWs((v) => !v)} /> 忽略空白差异
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={ignoreCase} onChange={() => setIgnoreCase((v) => !v)} /> 忽略大小写
        </label>
        {rows.length > 0 && (
          <span className="num">
            <span className="text-emerald-600">+{adds}</span> / <span className="text-red-600">-{dels}</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">原文 A</div>
          <Area value={a} onChange={setA} rows={14} mono placeholder="粘贴原文" />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">对比 B</div>
          <Area value={b} onChange={setB} rows={14} mono placeholder="粘贴修改后文本" />
        </div>
      </div>
      {rows.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-neutral-400">差异（红=删除，绿=新增）</div>
          <pre className="max-h-[360px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 font-mono text-xs leading-5">
            {rows.map((r, idx) => (
              <div key={idx} className={`px-3 ${
                r.type === "add" ? "bg-emerald-50 text-emerald-800" :
                r.type === "del" ? "bg-red-50 text-red-700 line-through" : "text-neutral-500"}`}>
                {r.type === "add" ? "+" : r.type === "del" ? "-" : " "} {r.text}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
