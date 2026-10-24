"use client";

/** JSON Diff：结构化对比两段 JSON，逐路径高亮增/删/改 */
import { useMemo, useState } from "react";
import { Area } from "./_ui";

type Change = { path: string; type: "add" | "del" | "chg"; a?: string; b?: string };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function walk(a: unknown, b: unknown, path: string, out: Change[]) {
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) out.push({ path: p, type: "add", b: JSON.stringify(b[k]) });
      else if (!(k in b)) out.push({ path: p, type: "del", a: JSON.stringify(a[k]) });
      else walk(a[k], b[k], p, out);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) out.push({ path: p, type: "add", b: JSON.stringify(b[i]) });
      else if (i >= b.length) out.push({ path: p, type: "del", a: JSON.stringify(a[i]) });
      else walk(a[i], b[i], p, out);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path, type: "chg", a: JSON.stringify(a), b: JSON.stringify(b) });
  }
}

export default function JsonDiff() {
  const [a, setA] = useState('{\n  "name": "IF.Cope",\n  "tools": 28,\n  "tags": ["学习", "AI"]\n}');
  const [b, setB] = useState('{\n  "name": "IF.Cope",\n  "tools": 43,\n  "author": "demo"\n}');
  const [ignoreOrder, setIgnoreOrder] = useState(true);

  const { changes, error } = useMemo(() => {
    if (!a.trim() || !b.trim()) return { changes: [] as Change[], error: "" };
    try {
      const ja = JSON.parse(a), jb = JSON.parse(b);
      const out: Change[] = [];
      walk(ja, jb, "", out);
      // ignoreOrder 目前用于提示（对象键顺序本就不影响 JSON 相等）
      void ignoreOrder;
      return { changes: out, error: "" };
    } catch (e) {
      return { changes: [] as Change[], error: e instanceof Error ? e.message : String(e) };
    }
  }, [a, b, ignoreOrder]);

  const stats = {
    add: changes.filter((c) => c.type === "add").length,
    del: changes.filter((c) => c.type === "del").length,
    chg: changes.filter((c) => c.type === "chg").length,
  };

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">JSON A（基准）</div>
          <Area value={a} onChange={setA} rows={12} mono />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">JSON B（对比）</div>
          <Area value={b} onChange={setB} rows={12} mono />
        </div>
      </div>
      {error && <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {!error && (a.trim() && b.trim()) && (
        <div className="border border-neutral-200">
          <div className="flex items-center gap-4 border-b border-neutral-100 px-3 py-2 text-xs">
            <span className="text-neutral-400">差异 {changes.length} 处</span>
            <span className="text-emerald-600">+{stats.add}</span>
            <span className="text-red-600">-{stats.del}</span>
            <span className="text-amber-600">~{stats.chg}</span>
          </div>
          {changes.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-neutral-400">两段 JSON 完全一致</div>
          ) : (
            changes.map((c, i) => (
              <div key={i} className={`border-b border-neutral-100 px-3 py-2 text-xs last:border-b-0 ${
                c.type === "add" ? "bg-emerald-50" : c.type === "del" ? "bg-red-50" : "bg-amber-50"}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-4 shrink-0 font-bold ${c.type === "add" ? "text-emerald-600" : c.type === "del" ? "text-red-600" : "text-amber-600"}`}>
                    {c.type === "add" ? "+" : c.type === "del" ? "-" : "~"}
                  </span>
                  <code className="font-mono text-neutral-700">{c.path || "(根)"}</code>
                </div>
                <div className="mt-1 pl-6 font-mono text-[11px]">
                  {c.a !== undefined && <div className="text-red-700">A: {c.a}</div>}
                  {c.b !== undefined && <div className="text-emerald-700">B: {c.b}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
