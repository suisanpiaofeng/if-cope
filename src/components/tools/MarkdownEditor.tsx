"use client";

/** Markdown 编辑预览：左编辑右实时渲染（复用共享 Markdown 渲染器），本地保存草稿 */
import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Actions, Btn, CopyBtn, useMounted } from "./_ui";

const KEY = "ifcope.tools.markdown-draft";
const SAMPLE = `# Markdown 编辑器\n\n左编辑、右预览，**实时**渲染。支持 *斜体*、~~删除~~、\`行内代码\`。\n\n## 列表\n- 支持无序列表\n- 支持 **加粗** 与 [链接](https://example.com)\n\n1. 有序列表\n2. 第二项\n\n> 引用块\n\n\`\`\`js\nconsole.log("代码块带高亮");\n\`\`\`\n\n| 表头 A | 表头 B |\n| ------ | ------ |\n| 单元格 | 单元格 |\n`;

export default function MarkdownEditor() {
  const mounted = useMounted();
  const [text, setText] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const d = localStorage.getItem(KEY);
    if (d !== null) setText(d);
    setDraftLoaded(true);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !draftLoaded) return;
    const t = setTimeout(() => { try { localStorage.setItem(KEY, text); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(t);
  }, [text, mounted, draftLoaded]);

  return (
    <div className="flex h-[calc(100vh-140px)] gap-3">
      <div className="flex w-1/2 flex-col">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">Markdown 源码（自动保存草稿）</span>
          <Actions>
            <CopyBtn text={text} />
            <Btn onClick={() => setText("")}>清空</Btn>
            <Btn onClick={() => setText(SAMPLE)}>示例</Btn>
          </Actions>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          className="min-h-0 flex-1 resize-none rounded-md border border-neutral-200 p-3 font-mono text-xs leading-6 outline-none focus:border-neutral-400"
          placeholder="在此编写 Markdown…" spellCheck={false} />
      </div>
      <div className="flex w-1/2 flex-col">
        <div className="mb-1 text-[11px] text-neutral-400">预览</div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-neutral-200 p-4">
          {text.trim() ? <Markdown text={text} /> : <div className="py-8 text-center text-xs text-neutral-400">暂无内容</div>}
        </div>
      </div>
    </div>
  );
}
