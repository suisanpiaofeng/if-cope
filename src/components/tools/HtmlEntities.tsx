"use client";

/** HTML 实体编解码：转义特殊字符 / 还原实体，双向实时 */
import { useMemo, useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

const MAP: [string, string][] = [
  ["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"],
];
const NAMED: Record<string, string> = Object.fromEntries(MAP.map(([c, e]) => [e, c]));
// 常见命名实体补充
Object.assign(NAMED, {
  "&nbsp;": " ", "&copy;": "©", "&reg;": "®", "&trade;": "™", "&hellip;": "…",
  "&mdash;": "—", "&middot;": "·", "&laquo;": "«", "&raquo;": "»", "&deg;": "°",
  "&plusmn;": "±", "&times;": "×", "&divide;": "÷", "&frac12;": "½", "&euro;": "€",
  "&pound;": "£", "&yen;": "¥", "&sect;": "§", "&para;": "¶", "&dagger;": "†",
});

function encodeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => NAMED[c] ?? c)
    .replace(/[一-龥]/g, (c) => `&#${c.codePointAt(0)!};`);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;/gi, (m) => NAMED[m.toLowerCase()] ?? m);
}

export default function HtmlEntities() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [hanAsNum, setHanAsNum] = useState(false);

  const output = useMemo(() => {
    if (!input) return "";
    try {
      if (mode === "decode") return decodeHtml(input);
      return hanAsNum
        ? input.replace(/[&<>"']/g, (c) => NAMED[c] ?? c).replace(/[一-龥]/g, (c) => `&#${c.codePointAt(0)!};`)
        : encodeHtml(input);
    } catch (e) {
      return `出错：${e instanceof Error ? e.message : e}`;
    }
  }, [input, mode, hanAsNum]);

  return (
    <div className="max-w-[720px]">
      <Actions>
        <Select label="方向" value={mode} onChange={setMode}
          options={[{ value: "encode", label: "转义（→实体）" }, { value: "decode", label: "还原（实体→文本）" }]} />
        {mode === "encode" && (
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            <input type="checkbox" checked={hanAsNum} onChange={() => setHanAsNum((v) => !v)} /> 汉字转数字实体
          </label>
        )}
        <Btn onClick={() => { setInput(output); setMode(mode === "encode" ? "decode" : "encode"); }}>结果→输入</Btn>
        <CopyBtn text={output} />
      </Actions>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">输入</div>
          <Area value={input} onChange={setInput} rows={12} mono />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">输出</div>
          <Out value={output} />
        </div>
      </div>
    </div>
  );
}
