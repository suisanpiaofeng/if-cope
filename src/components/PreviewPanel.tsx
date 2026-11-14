"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/types";
import type { Artifact } from "./FilesPanel";
import type { FilePreviewKind } from "@/lib/preview";
import { isEditableExt } from "@/lib/preview";
import { downloadArtifact } from "@/lib/download";
import NoteRenderer from "@/components/notes/NoteRenderer";
import CodeEditor from "./CodeEditor";
import { lineDiff } from "@/lib/agent/diff";
import { Markdown, CodeBlock } from "./Markdown";

export type SaveFileResult = {
  ok: boolean; status?: string; chunk_count?: number; note?: string | null; error?: string;
};

export type PreviewTab =
  | { key: string; kind: "source"; id: number; title: string; loading?: boolean; chunks?: { page: number | null; text: string }[]; highlight?: string }
  | { key: string; kind: "artifact"; id: number; title: string; artifactType?: string; loading?: boolean; markdown?: string }
  /** 原始文件预览：markdown 渲染 / 图片 / 代码高亮 / 纯文本 / pdf / docx / 网页正文 */
  | { key: string; kind: "file"; fileType: FilePreviewKind; ext: string; id: number; title: string; loading?: boolean; text?: string; html?: string; error?: string; wsPath?: string };

/** 第三栏：多标签预览（可开多个、× 关闭） */
export default function PreviewPanel({
  tabs, activeKey, onSelect, onClose, onSaveFile, onOpenSourceById,
}: {
  tabs: PreviewTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onSaveFile: (id: number, text: string, tab?: PreviewTab) => Promise<SaveFileResult>;
  /** 引用跳转：按 sourceId 打开源预览 */
  onOpenSourceById?: (sourceId: number) => void;
}) {
  const active = tabs.find((t) => t.key === activeKey) ?? null;

  // 草稿：按 tab key 记录（切走保留，关闭时才提示丢弃）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 对比视图（harness P1 §7.1）：按 tab key 开关
  const [diffView, setDiffView] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveMsgs, setSaveMsgs] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [downloading, setDownloading] = useState(false);
  // 滚轮缩放（原生监听，React onWheel 是 passive 无法 preventDefault）：
  // 图片 = 直接滚轮缩放；其他内容 = Ctrl+滚轮
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const zoom = active ? zooms[active.key] ?? 1 : 1;

  const sectionRef = useRef<HTMLElement | null>(null);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const imageKeyRef = useRef<string | null>(null);
  imageKeyRef.current =
    active?.kind === "file" && active.fileType === "image" && !active.error ? active.key : null;
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const k = activeKeyRef.current;
      if (!k) return;
      const isImage = imageKeyRef.current === k;
      // 图片：裸滚轮缩放；其他：必须按住 Ctrl/Cmd
      if (!isImage && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZooms((prev) => {
        const cur = prev[k] ?? 1;
        if (isImage) {
          // 图片：乘法缩放，滚动手感更顺（0.2×–5×）
          const next = cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
          return { ...prev, [k]: Math.min(5, Math.max(0.2, next)) };
        }
        const step = e.deltaY < 0 ? 0.1 : -0.1;
        const next = Math.round((cur + step) * 10) / 10;
        return { ...prev, [k]: Math.min(3, Math.max(0.4, next)) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const activeFile = active?.kind === "file" ? active : null;
  const canEdit = Boolean(
    activeFile && !activeFile.loading && !activeFile.error && activeFile.text != null && isEditableExt(activeFile.ext)
  );
  const dirty = Boolean(
    activeFile && canEdit && drafts[activeFile.key] !== undefined && drafts[activeFile.key] !== activeFile.text
  );

  async function saveActive() {
    if (!activeFile || savingKey) return;
    const key = activeFile.key;
    const text = drafts[key] ?? activeFile.text ?? "";
    setSavingKey(key);
    try {
      const r = await onSaveFile(activeFile.id, text, activeFile);
      if (r.ok) {
        setSaveMsgs((m) => ({
          ...m,
          [key]: r.status === "ws"
            ? { ok: true, text: "已保存到工作区" }
            : r.status === "ready"
            ? { ok: true, text: `已保存 · 索引已重建（${r.chunk_count ?? 0} 块）` }
            : { ok: false, text: `文件已保存，但索引重建失败：${r.note ?? "未知原因"}` },
        }));
        setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      } else {
        setSaveMsgs((m) => ({ ...m, [key]: { ok: false, text: `保存失败：${r.error ?? "未知错误"}` } }));
      }
    } catch (e) {
      setSaveMsgs((m) => ({ ...m, [key]: { ok: false, text: `保存失败：${e instanceof Error ? e.message : String(e)}` } }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section ref={sectionRef} className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden border-r border-neutral-300 bg-white">
      {/* 标签栏 */}
      <div className="flex items-stretch overflow-x-auto border-b border-neutral-200">
        {tabs.length === 0 && (
          <div className="px-4 py-2.5 text-xs text-neutral-300">未打开文件</div>
        )}
        {tabs.map((t) => (
          <div
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`group flex max-w-[200px] cursor-pointer items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
              t.key === activeKey
                ? "border-neutral-900 bg-neutral-50/50 font-medium text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900"
            }`}
          >
            {t.kind === "artifact" && (
              <svg className="h-3 w-3 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M4 2h5l3 3v9H4V2Z" /><path d="M9 2v3h3" />
              </svg>
            )}
            {t.kind === "file" && (
              <span className="num shrink-0 rounded bg-neutral-100 px-1 text-[10px] uppercase text-neutral-500">{t.ext}</span>
            )}
            <span className="truncate">{t.title}</span>
            {t.kind === "file" && drafts[t.key] !== undefined && drafts[t.key] !== t.text && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="有未保存的修改" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (t.kind === "file" && drafts[t.key] !== undefined && drafts[t.key] !== t.text &&
                    !window.confirm("该文件有未保存的修改，关闭将丢失。确定关闭？")) return;
                onClose(t.key);
              }}
              className="shrink-0 rounded px-0.5 text-xs text-neutral-300 hover:bg-neutral-200 hover:text-neutral-700"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* 工具条：文本类文件可直接编辑，无需切换 */}
      {activeFile && canEdit && (
        <div className="flex items-center gap-2.5 border-b border-neutral-100 bg-neutral-50/40 px-4 py-1.5">
          <button onClick={() => void saveActive()} disabled={savingKey !== null || !dirty}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
            {savingKey === activeFile.key ? "保存并重建索引中…" : "保存 (Ctrl+S)"}
          </button>
          {dirty && <span className="text-[11px] text-amber-600">未保存</span>}
          {dirty && (
            <button
              onClick={() => setDiffView((d) => ({ ...d, [activeFile.key]: !d[activeFile.key] }))}
              className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-white"
            >
              {diffView[activeFile.key] ? "返回编辑" : "对比"}
            </button>
          )}
          <span className="text-[11px] text-neutral-400">
            {activeFile.fileType === "markdown" ? "左侧编辑 · 右侧实时渲染" : "直接编辑即可，保存后重建检索索引"}
          </span>
          {saveMsgs[activeFile.key] && (
            <span className={`text-[11px] ${saveMsgs[activeFile.key].ok ? "text-emerald-600" : "text-red-600"}`}>
              {saveMsgs[activeFile.key].text}
            </span>
          )}
          <span className="ml-auto text-[11px] uppercase text-neutral-300">{activeFile.ext}</span>
        </div>
      )}

      {/* 工具条：产物可下载到本地 */}
      {active?.kind === "artifact" && !active.loading && (
        <div className="flex items-center gap-2.5 border-b border-neutral-100 bg-neutral-50/40 px-4 py-1.5">
          <button
            onClick={() => {
              setDownloading(true);
              downloadArtifact(active.id, active.title)
                .catch((err) => setSaveMsgs((m) => ({ ...m, [active.key]: { ok: false, text: err instanceof Error ? err.message : "下载失败" } })))
                .finally(() => setDownloading(false));
            }}
            disabled={downloading}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
            {downloading ? "下载中…" : "⤓ 下载 .md"}
          </button>
          <span className="text-[11px] text-neutral-400">产物已存于未归类，可拖拽到其他类目分类</span>
          {saveMsgs[active.key] && !saveMsgs[active.key].ok && (
            <span className="text-[11px] text-red-600">{saveMsgs[active.key].text}</span>
          )}
        </div>
      )}

      {/* 内容区：文本类直接进编辑器；Markdown 左右分屏实时渲染；其余只读；对比态渲染行 diff */}
      {canEdit && activeFile && diffView[activeFile.key] ? (
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-50/40 px-4 py-3" style={{ zoom }}>
          {lineDiff(activeFile.text ?? "", drafts[activeFile.key] ?? "").map((l, i) => (
            <div
              key={i}
              className={`mono whitespace-pre-wrap rounded px-2 py-[1px] text-[11px] leading-5 ${
                l.type === "add" ? "bg-emerald-50 text-emerald-800" : l.type === "del" ? "bg-red-50 text-red-700" : "text-neutral-500"
              }`}
            >
              <span className="select-none text-neutral-300">{l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}</span>
              {l.text || "（空行）"}
            </div>
          ))}
        </div>
      ) : canEdit && activeFile ? (
        activeFile.fileType === "markdown" ? (
          /* flex 分栏：左右各自独立滚动，右栏滚动确定到底 */
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-1/2 min-w-0 overflow-hidden border-r border-neutral-200">
              <CodeEditor
                key={activeFile.key}
                value={drafts[activeFile.key] ?? activeFile.text ?? ""}
                ext={activeFile.ext}
                zoom={zoom}
                onChange={(v) => setDrafts((d) => ({ ...d, [activeFile.key]: v }))}
                onSave={() => void saveActive()}
                className="h-full"
              />
            </div>
            <div className="w-1/2 min-w-0 overflow-y-auto bg-neutral-50/30">
              <div className="px-6 py-4" style={{ zoom }}>
                <Markdown text={drafts[activeFile.key] ?? activeFile.text ?? ""} />
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeEditor
              key={activeFile.key}
              value={drafts[activeFile.key] ?? activeFile.text ?? ""}
              ext={activeFile.ext}
              zoom={zoom}
              onChange={(v) => setDrafts((d) => ({ ...d, [activeFile.key]: v }))}
              onSave={() => void saveActive()}
              className="h-full"
            />
          </div>
        )
      ) : active?.kind === "file" && active.fileType === "pdf" && !active.loading && !active.error ? (
        /* PDF：浏览器原生渲染器，铺满内容区 */
        <iframe className="min-h-0 flex-1 border-0" src={`/api/preview/${active.id}`} title={active.title} />
      ) : active?.kind === "file" && active.fileType === "image" && !active.loading && !active.error ? (
        /* 图片：Ctrl+滚轮缩放 + 拖拽平移 + 双击复位 */
        <div className="min-h-0 flex-1 overflow-hidden">
          <ImagePreview id={active.id} title={active.title} zoom={zoom} onReset={() => setZooms((z) => ({ ...z, [active.key]: 1 }))} />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!active || active.loading ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <svg className="h-10 w-10 text-neutral-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M5 4h9l5 5v11H5V4Z" /><path d="M14 4v5h5" />
            </svg>
            <p className="mt-3 text-sm text-neutral-400">
              {active ? "加载中…" : "从左侧文件列表点击任意资源或成果，在此预览"}
            </p>
          </div>
        ) : (
        <div style={{ zoom }}>
          {active.kind === "source" ? (
            <SourceContent chunks={active.chunks ?? []} highlight={active.highlight} />
          ) : active.kind === "artifact" ? (
            NoteRenderer({ type: active.artifactType, content: active.markdown ?? "", onCite: (c) => onOpenSourceById?.(c.sourceId) }) ?? (
              <Markdown text={active.markdown ?? ""} />
            )
          ) : active.error ? (
            <p className="pt-20 text-center text-sm text-red-500">{active.error}</p>
          ) : active.fileType === "docx" ? (
          /* DOCX：服务端 mammoth 转的语义化 HTML */
          <div
            className="docx-view mx-auto max-w-[760px] text-sm leading-7 text-neutral-700"
            dangerouslySetInnerHTML={{ __html: active.html ?? "" }}
          />
        ) : active.fileType === "site" ? (
          /* 网页正文：爬取的纯文本 */
          <div className="mx-auto max-w-[760px] text-sm leading-7 text-neutral-700">
            <p className="mb-4 border-b border-neutral-100 pb-2 text-xs text-neutral-400">
              网页正文（来自爬取）
            </p>
            <p className="whitespace-pre-wrap">{active.text}</p>
          </div>
        ) : active.fileType === "markdown" ? (
          <Markdown text={active.text ?? ""} />
        ) : active.fileType === "code" ? (
          <CodeBlock code={active.text ?? ""} lang={active.ext} />
        ) : (
          <pre className="mx-auto max-w-[860px] whitespace-pre-wrap break-words text-sm leading-7 text-neutral-700">{active.text}</pre>
        )}
        </div>
        )}
      </div>
      )}

      {/* 缩放指示（仅非 100% 时显示，双击复位） */}
      {Math.abs(zoom - 1) > 0.01 && active && (
        <button
          onDoubleClick={() => setZooms((z) => ({ ...z, [active.key]: 1 }))}
          title={
            active.kind === "file" && active.fileType === "image"
              ? "滚轮缩放 · 按住拖动 · 双击复位"
              : "双击复位（Ctrl+滚轮缩放）"
          }
          className="num absolute bottom-3 right-4 z-10 rounded-md border border-neutral-200 bg-white/95 px-2 py-1 text-[11px] text-neutral-600 shadow-sm hover:border-neutral-400"
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
    </section>
  );
}

/** 图片预览：Ctrl+滚轮缩放（zoom 来自外层），拖拽平移，双击复位 */
function ImagePreview({ id, title, zoom, onReset }: {
  id: number; title: string; zoom: number; onReset: () => void;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    // 长按（按住）即可拖动，无需放大；仅图片有此行为
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setPos({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) });
  }
  function onPointerUp() { dragRef.current = null; setDragging(false); }
  function reset() { setPos({ x: 0, y: 0 }); onReset(); }

  return (
    <div
      className="flex h-full select-none items-center justify-center overflow-hidden"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
    >
      <img
        src={`/api/preview/${id}`}
        alt={title}
        draggable={false}
        className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
          transformOrigin: "center",
          transition: dragging ? "none" : "transform 0.1s ease-out",
        }}
      />
    </div>
  );
}

function SourceContent({ chunks, highlight }: { chunks: { page: number | null; text: string }[]; highlight?: string }) {
  if (chunks.length === 0)
    return <p className="pt-20 text-center text-sm text-neutral-400">该资源暂无可展示的解析文本（图片/音频需配置模型后解析）。</p>;
  // 引用溯源（P3-3 §4.4）：定位高亮片段
  const mark = (text: string) => {
    if (!highlight || !text.includes(highlight)) return text;
    const parts = text.split(highlight);
    return parts.flatMap((p, i) =>
      i < parts.length - 1
        ? [p, <mark key={i} className="rounded bg-amber-100 px-0.5">{highlight}</mark>]
        : [p]
    );
  };
  return (
    <div className="mx-auto max-w-[680px] space-y-4 text-sm leading-7 text-neutral-700">
      {highlight && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          📍 引用定位：<span className="mono">{highlight.slice(0, 80)}</span>（已在正文高亮）
        </div>
      )}
      {chunks.map((c, i) => (
        <div key={i}>
          {c.page != null && <div className="num mb-1 text-[11px] text-neutral-400">第 {c.page} 页</div>}
          <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3">{mark(c.text)}</p>
        </div>
      ))}
    </div>
  );
}

