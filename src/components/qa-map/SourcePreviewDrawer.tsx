"use client";

/** 引用右侧预览抽屉：复用工作台的 PreviewPanel（单标签），不新开网页 */
import { useEffect, useState } from "react";
import PreviewPanel, { type PreviewTab, type SaveFileResult } from "@/components/PreviewPanel";
import { filePreviewKind } from "@/lib/preview";
import type { Source } from "@/lib/types";

export default function SourcePreviewDrawer({
  source,
  onClose,
}: {
  source: Source | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PreviewTab | null>(null);

  useEffect(() => {
    if (!source) {
      setTab(null);
      return;
    }
    const s = source;
    const key = `src-${s.id}-${Date.now()}`;
    // 与工作台 openSource 相同的取内容逻辑
    if (s.source_type === "link") {
      setTab({ key, kind: "file", fileType: "site", ext: "url", id: s.id, title: s.title, loading: true });
      fetch(`/api/preview/${s.id}`)
        .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error ?? `HTTP ${r.status}`)))))
        .then((d) => setTab({ key, kind: "file", fileType: "site", ext: "url", id: s.id, title: s.title, text: d.text, error: d.warning ? `⚠ ${d.warning}` : undefined }))
        .catch((err) => setTab({ key, kind: "file", fileType: "site", ext: "url", id: s.id, title: s.title, error: `爬取失败：${err instanceof Error ? err.message : String(err)}` }));
      return;
    }
    const kind = s.source_type === "file" ? filePreviewKind(s.ext) : null;
    if (kind) {
      const streaming = kind === "image" || kind === "pdf";
      setTab({ key, kind: "file", fileType: kind, ext: s.ext, id: s.id, title: s.title, loading: !streaming });
      if (!streaming) {
        fetch(`/api/preview/${s.id}`)
          .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error ?? `HTTP ${r.status}`)))))
          .then((d) => setTab({ key, kind: "file", fileType: kind, ext: s.ext, id: s.id, title: s.title, text: d.text, html: d.html }))
          .catch((err) => setTab({ key, kind: "file", fileType: kind, ext: s.ext, id: s.id, title: s.title, error: `读取失败：${err instanceof Error ? err.message : String(err)}` }));
      }
      return;
    }
    setTab({ key, kind: "source", id: s.id, title: s.title, loading: true });
    fetch(`/api/lookup?sourceId=${s.id}`)
      .then((r) => r.json())
      .then((d) => setTab({ key, kind: "source", id: s.id, title: s.title, chunks: d.chunks }));
  }, [source]);

  async function saveFileText(id: number, text: string): Promise<SaveFileResult> {
    const res = await fetch(`/api/sources/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return (await res.json()) as SaveFileResult;
  }

  if (!source || !tab) return null;

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-700">
          📎 {source.title}
        </span>
        <button onClick={onClose} className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-50">
          关闭
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PreviewPanel
          tabs={[tab]}
          activeKey={tab.key}
          onSelect={() => {}}
          onClose={onClose}
          onSaveFile={saveFileText}
        />
      </div>
    </aside>
  );
}
