"use client";

/** 流程图渲染：提取 ```mermaid 代码块 → mermaid 渲染 SVG */
import { useEffect, useMemo, useState } from "react";
import mermaid from "mermaid";

function extractBlocks(content: string): string[] {
  const out: string[] = [];
  const re = /```mermaid\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1].trim());
  if (out.length === 0 && /^\s*(flowchart|graph|sequenceDiagram|stateDiagram)/m.test(content)) {
    out.push(content.trim());
  }
  return out;
}

export default function MermaidView({ content }: { content: string }) {
  const blocks = useMemo(() => extractBlocks(content), [content]);
  const [svgs, setSvgs] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });
      const ok: string[] = [];
      const bad: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        try {
          const { svg } = await mermaid.render(`ifcope-mmd-${Date.now()}-${i}`, blocks[i]);
          ok[i] = svg;
        } catch (e) {
          bad[i] = e instanceof Error ? e.message : String(e);
        }
      }
      if (!cancelled) {
        setSvgs(ok);
        setErrors(bad);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div>
        <div className="border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          未找到 mermaid 代码块，以下为原文（可在编辑后重试）：
        </div>
        <pre className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">{content}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {blocks.map((_, i) => (
        <div key={i} className="border border-neutral-200 p-3">
          {svgs[i] ? (
            <div className="overflow-auto" dangerouslySetInnerHTML={{ __html: svgs[i] }} />
          ) : errors[i] ? (
            <div className="text-sm text-red-600">流程图渲染失败：{errors[i]}</div>
          ) : (
            <div className="p-4 text-sm text-neutral-400">渲染中…</div>
          )}
        </div>
      ))}
    </div>
  );
}
