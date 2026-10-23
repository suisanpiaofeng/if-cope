"use client";

/** 字数统计：字符 / 词数 / 行数 / 体积，实时统计 */
import { useMemo, useState } from "react";

export default function TextStats() {
  const [text, setText] = useState("");
  const s = useMemo(() => {
    const han = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    const en = (text.match(/[a-zA-Z]+/g) ?? []).length;
    return {
      chars: text.length,
      charsNoSpace: text.replace(/\s/g, "").length,
      lines: text ? text.split("\n").length : 0,
      words: han + en,
      han,
      en,
      numbers: (text.match(/\d+(?:\.\d+)?/g) ?? []).length,
      bytes: new TextEncoder().encode(text).length,
    };
  }, [text]);

  const items: [string, string | number][] = [
    ["字符数", s.chars],
    ["不含空白", s.charsNoSpace],
    ["词数", s.words],
    ["行数", s.lines],
    ["汉字", s.han],
    ["英文单词", s.en],
    ["数字", s.numbers],
    ["体积", `${(s.bytes / 1024).toFixed(2)} KB`],
  ];

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴或输入文字，统计实时更新…"
        className="h-[320px] w-full resize-y rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
      />
      <div className="mt-4 grid grid-cols-4 gap-2">
        {items.map(([label, v]) => (
          <div key={label} className="border border-neutral-200 px-3 py-2">
            <div className="text-[11px] text-neutral-400">{label}</div>
            <div className="num mt-0.5 text-lg font-semibold text-neutral-900">{v}</div>
          </div>
        ))}
      </div>
      {text && (
        <button onClick={() => setText("")} className="mt-3 border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
          清空
        </button>
      )}
    </div>
  );
}
