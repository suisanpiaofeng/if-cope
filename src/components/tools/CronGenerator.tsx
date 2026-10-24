"use client";

/** Cron 生成器：点选式生成五段式表达式 + 下次运行时间预览 */
import { useMemo, useState } from "react";
import { Actions, CopyBtn, Out } from "./_ui";

const PRESETS: { label: string; cron: string }[] = [
  { label: "每分钟", cron: "* * * * *" },
  { label: "每小时整点", cron: "0 * * * *" },
  { label: "每天 0 点", cron: "0 0 * * *" },
  { label: "每天 9 点", cron: "0 9 * * *" },
  { label: "每周一 9 点", cron: "0 9 * * 1" },
  { label: "每月 1 号 0 点", cron: "0 0 1 * *" },
  { label: "工作日 9 点", cron: "0 9 * * 1-5" },
];

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function nextRuns(expr: string, count = 5): string[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [mi, ho, dom, mon, dow] = parts;
  const match = (field: string, v: number, max: number) => {
    if (field === "*") return true;
    for (const seg of field.split(",")) {
      if (seg.includes("-")) {
        const [a, b] = seg.split("-").map(Number);
        if (v >= a && v <= b) return true;
      } else if (seg.startsWith("*/")) {
        const step = Number(seg.slice(2));
        if (step && v % step === 0) return true;
      } else if (Number(seg) === v) return true;
    }
    return false;
  };
  const out: string[] = [];
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let guard = 0; guard < 60 * 24 * 400 && out.length < count; guard++) {
    if (match(mi, d.getMinutes(), 59) && match(ho, d.getHours(), 23) &&
        match(dom, d.getDate(), 31) && match(mon, d.getMonth() + 1, 12) &&
        match(dow, d.getDay(), 6)) {
      out.push(`${d.toLocaleDateString("zh-CN")} 周${WEEK[d.getDay()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

function Field({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max: number }) {
  return (
    <div className="flex-1">
      <div className="mb-1 text-[11px] text-neutral-400">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-center font-mono text-sm outline-none focus:border-neutral-400" />
      <div className="mt-1 flex flex-wrap gap-0.5">
        {["*", `*/5`].map((q) => (
          <button key={q} onClick={() => onChange(q)}
            className="border border-neutral-200 px-1 text-[10px] text-neutral-500 hover:bg-neutral-50">{q}</button>
        ))}
        {Array.from({ length: Math.min(max, 6) }, (_, i) => (
          <button key={i} onClick={() => onChange(String(i))}
            className="border border-neutral-200 px-1 text-[10px] text-neutral-500 hover:bg-neutral-50">{i}</button>
        ))}
      </div>
    </div>
  );
}

export default function CronGenerator() {
  const [f, setF] = useState({ mi: "0", ho: "9", dom: "*", mon: "*", dow: "*" });
  const expr = `${f.mi} ${f.ho} ${f.dom} ${f.mon} ${f.dow}`;
  const runs = useMemo(() => nextRuns(expr), [expr]);

  return (
    <div className="max-w-[640px] space-y-4">
      <div className="flex gap-2">
        <Field label="分 (0-59)" value={f.mi} max={6} onChange={(v) => setF({ ...f, mi: v })} />
        <Field label="时 (0-23)" value={f.ho} max={6} onChange={(v) => setF({ ...f, ho: v })} />
        <Field label="日 (1-31)" value={f.dom} max={6} onChange={(v) => setF({ ...f, dom: v })} />
        <Field label="月 (1-12)" value={f.mon} max={6} onChange={(v) => setF({ ...f, mon: v })} />
        <Field label="周 (0-6)" value={f.dow} max={7} onChange={(v) => setF({ ...f, dow: v })} />
      </div>

      <Out label="Cron 表达式" value={expr} />

      <div>
        <div className="mb-1 text-[11px] text-neutral-400">常用预设</div>
        <Actions>
          {PRESETS.map((p) => (
            <button key={p.cron} onClick={() => {
              const [mi, ho, dom, mon, dow] = p.cron.split(" ");
              setF({ mi, ho, dom, mon, dow });
            }}
              className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
              {p.label}
            </button>
          ))}
        </Actions>
      </div>

      <div className="border border-neutral-200">
        <div className="border-b border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">接下来运行</div>
        {runs.length ? runs.map((r, i) => (
          <div key={i} className="num border-b border-neutral-100 px-3 py-1.5 font-mono text-xs text-neutral-700 last:border-b-0">{r}</div>
        )) : <div className="px-3 py-2 text-xs text-neutral-400">无法解析（需五段式，字段用空格分隔）</div>}
      </div>
    </div>
  );
}
