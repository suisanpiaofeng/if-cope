"use client";

/** 时间戳转换：Unix 时间戳 ↔ 可读时间（秒 / 毫秒自动识别） */
import { useEffect, useState } from "react";

function fmt(ts: number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "（无效时间戳）";
  return d.toLocaleString("zh-CN", { hour12: false }) + `.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export default function Timestamp() {
  const [now, setNow] = useState(Date.now());
  const [tsInput, setTsInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const tsResult = (() => {
    const raw = tsInput.trim();
    if (!raw) return "";
    const n = Number(raw);
    if (isNaN(n)) return "（无效数字）";
    return fmt(raw.length <= 10 ? n * 1000 : n);
  })();

  const dateResult = (() => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "（无效时间）";
    return `${Math.floor(d.getTime() / 1000)}（秒） / ${d.getTime()}（毫秒）`;
  })();

  function copy(text: string, tag: string) {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(""), 1200);
  }

  return (
    <div className="max-w-[560px] space-y-4">
      <div className="border border-neutral-900 bg-neutral-900 px-4 py-3 text-white">
        <div className="text-[11px] text-neutral-400">当前时间</div>
        <div className="num mt-1 text-lg font-semibold">{fmt(now)}</div>
        <div className="num mt-1 text-xs text-neutral-400">
          {Math.floor(now / 1000)}（秒） / {now}（毫秒）
          <button onClick={() => copy(String(Math.floor(now / 1000)), "now")} className="ml-2 border border-neutral-600 px-2 py-0.5 text-[10px] hover:bg-neutral-800">
            {copied === "now" ? "已复制" : "复制秒"}
          </button>
        </div>
      </div>

      <div className="border border-neutral-200 p-4">
        <div className="mb-2 text-sm font-semibold">时间戳 → 时间</div>
        <div className="flex gap-2">
          <input
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            placeholder="如 1761234567 或 1761234567890"
            className="flex-1 rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-400"
          />
          <button onClick={() => setTsInput(String(Math.floor(Date.now() / 1000)))}
            className="border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-50">取当前</button>
        </div>
        {tsResult && <div className="mt-2 text-sm text-neutral-800">{tsResult}</div>}
      </div>

      <div className="border border-neutral-200 p-4">
        <div className="mb-2 text-sm font-semibold">时间 → 时间戳</div>
        <input
          type="datetime-local"
          step="1"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
        {dateResult && <div className="num mt-2 text-sm text-neutral-800">{dateResult}</div>}
      </div>
    </div>
  );
}
