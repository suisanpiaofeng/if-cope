"use client";

/** 大小写 / 命名风格转换：camel/snake/kebab/pascal/常量/句式/标题 */
import { useMemo, useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out } from "./_ui";

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.:/\\]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const CASES: { key: string; name: string; fn: (w: string[]) => string }[] = [
  { key: "camel", name: "camelCase", fn: (w) => w.map((x, i) => (i ? cap(x) : x)).join("") },
  { key: "pascal", name: "PascalCase", fn: (w) => w.map(cap).join("") },
  { key: "snake", name: "snake_case", fn: (w) => w.join("_") },
  { key: "kebab", name: "kebab-case", fn: (w) => w.join("-") },
  { key: "const", name: "CONSTANT_CASE", fn: (w) => w.join("_").toUpperCase() },
  { key: "title", name: "Title Case", fn: (w) => w.map(cap).join(" ") },
  { key: "sentence", name: "Sentence case", fn: (w) => (w.length ? cap(w[0]) + (w.length > 1 ? " " + w.slice(1).join(" ") : "") : "") },
  { key: "lower", name: "lower case", fn: (w) => w.join(" ") },
  { key: "upper", name: "UPPER CASE", fn: (w) => w.join(" ").toUpperCase() },
];

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export default function CaseConverter() {
  const [input, setInput] = useState("hello world example");
  const results = useMemo(() => {
    if (!input.trim()) return [];
    const w = words(input);
    return CASES.map((c) => ({ name: c.name, value: c.fn(w) }));
  }, [input]);

  return (
    <div className="max-w-[640px]">
      <Area value={input} onChange={setInput} rows={4}
        placeholder="输入任意文本（支持空格/下划线/连字符/驼峰混合）" />
      {results.length > 0 && (
        <div className="mt-3 space-y-px">
          {results.map((r) => (
            <div key={r.name} className="flex items-center gap-3 border border-neutral-200 px-3 py-2">
              <span className="w-32 shrink-0 text-[11px] text-neutral-400">{r.name}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-800">{r.value}</code>
              <CopyBtn text={r.value} label="复制" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
