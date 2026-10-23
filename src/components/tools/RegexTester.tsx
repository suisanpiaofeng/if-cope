"use client";

/** 正则测试：实时匹配 + 高亮 + 常用模板 */
import { useMemo, useState } from "react";

const TEMPLATES: [string, string, string][] = [
  ["手机号", "^1[3-9]\\d{9}$", ""],
  ["邮箱", "^[\\w.-]+@[\\w.-]+\\.\\w+$", ""],
  ["中文", "[\\u4e00-\\u9fa5]", "g"],
  ["URL", "https?://[^\\s]+", "g"],
  ["学号", "\\d{8,12}", "g"],
  ["日期", "\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}", "g"],
];

export default function RegexTester() {
  const [pattern, setPattern] = useState("\\d+");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("2026-10-23，学号 21301234，手机 13800138000。");

  const result = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      const matches: { index: number; value: string }[] = [];
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) && guard++ < 500) {
        matches.push({ index: m.index, value: m[0] });
        if (m[0] === "") re.lastIndex++;
      }
      return { matches, error: "" };
    } catch (e) {
      return { matches: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [pattern, flags, text]);

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center rounded-md border border-neutral-200">
          <span className="px-2 font-mono text-sm text-neutral-400">/</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="flex-1 py-2 font-mono text-sm outline-none"
            placeholder="正则表达式"
          />
          <span className="px-2 font-mono text-sm text-neutral-400">/</span>
          <input
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            className="w-14 py-2 font-mono text-sm outline-none"
            placeholder="flags"
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TEMPLATES.map(([name, p, f]) => (
          <button
            key={name}
            onClick={() => { setPattern(p); setFlags(f); }}
            className="border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
          >
            {name}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="测试文本"
        className="mt-3 h-[200px] w-full resize-y rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
      />
      {result.error ? (
        <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">正则错误：{result.error}</div>
      ) : (
        <div className="mt-3">
          <div className="mb-1 text-xs text-neutral-500">
            匹配 <span className="num font-semibold text-neutral-900">{result.matches.length}</span> 处
          </div>
          <div className="max-h-[220px] overflow-y-auto border border-neutral-200">
            {result.matches.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-neutral-400">无匹配</div>
            ) : (
              result.matches.map((m, i) => (
                <div key={i} className="flex gap-3 border-b border-neutral-100 px-3 py-1.5 text-xs last:border-b-0">
                  <span className="num w-12 shrink-0 text-neutral-400">@{m.index}</span>
                  <span className="font-mono text-neutral-800">{m.value}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
