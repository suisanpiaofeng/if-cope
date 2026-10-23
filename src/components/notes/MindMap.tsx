"use client";

/** 思维导图渲染：markdown 层级大纲 → markmap（markmap-lib 解析 + markmap-view 渲染） */
import { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

export default function MindMap({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const { root } = new Transformer().transform(content);
      el.innerHTML = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("style", "width:100%;height:100%");
      el.appendChild(svg);
      Markmap.create(svg, { autoFit: true }, root);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [content]);

  if (error) {
    return <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">导图渲染失败：{error}</div>;
  }
  return <div ref={ref} className="h-[calc(100vh-300px)] min-h-[420px] w-full" />;
}
