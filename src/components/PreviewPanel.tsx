"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/types";
import type { Artifact } from "./FilesPanel";
import type { FilePreviewKind } from "@/lib/preview";
import { isEditableExt } from "@/lib/preview";
import { downloadArtifact } from "@/lib/download";
import NoteRenderer from "@/components/notes/NoteRenderer";
import CodeEditor from "./CodeEditor";

export type SaveFileResult = {
  ok: boolean; status?: string; chunk_count?: number; note?: string | null; error?: string;
};

export type PreviewTab =
  | { key: string; kind: "source"; id: number; title: string; loading?: boolean; chunks?: { page: number | null; text: string }[] }
  | { key: string; kind: "artifact"; id: number; title: string; artifactType?: string; loading?: boolean; markdown?: string }
  /** 原始文件预览：markdown 渲染 / 图片 / 代码高亮 / 纯文本 / pdf / docx / 网页正文 */
  | { key: string; kind: "file"; fileType: FilePreviewKind; ext: string; id: number; title: string; loading?: boolean; text?: string; html?: string; error?: string };

/** 第三栏：多标签预览（可开多个、× 关闭） */
export default function PreviewPanel({
  tabs, activeKey, onSelect, onClose, onSaveFile,
}: {
  tabs: PreviewTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onSaveFile: (id: number, text: string) => Promise<SaveFileResult>;
}) {
  const active = tabs.find((t) => t.key === activeKey) ?? null;

  // 草稿：按 tab key 记录（切走保留，关闭时才提示丢弃）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
      const r = await onSaveFile(activeFile.id, text);
      if (r.ok) {
        setSaveMsgs((m) => ({
          ...m,
          [key]: r.status === "ready"
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
          <span className="text-[11px] text-neutral-400">产物已存于 AIGC 类目，可拖拽到其他类目分类</span>
          {saveMsgs[active.key] && !saveMsgs[active.key].ok && (
            <span className="text-[11px] text-red-600">{saveMsgs[active.key].text}</span>
          )}
        </div>
      )}

      {/* 内容区：文本类直接进编辑器；Markdown 左右分屏实时渲染；其余只读 */}
      {canEdit && activeFile ? (
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
            <SourceContent chunks={active.chunks ?? []} />
          ) : active.kind === "artifact" ? (
            NoteRenderer({ type: active.artifactType, content: active.markdown ?? "" }) ?? (
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

function SourceContent({ chunks }: { chunks: { page: number | null; text: string }[] }) {
  if (chunks.length === 0)
    return <p className="pt-20 text-center text-sm text-neutral-400">该资源暂无可展示的解析文本（图片/音频需配置模型后解析）。</p>;
  return (
    <div className="mx-auto max-w-[680px] space-y-4 text-sm leading-7 text-neutral-700">
      {chunks.map((c, i) => (
        <div key={i}>
          {c.page != null && <div className="num mb-1 text-[11px] text-neutral-400">第 {c.page} 页</div>}
          <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3">{c.text}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Markdown 渲染（轻量自实现，覆盖常用语法） ---------------- */

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown mx-auto max-w-[760px] text-sm leading-7 text-neutral-700">
      {renderBlocks(text)}
    </div>
  );
}

function renderBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```lang ... ```
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过收尾 ```
      out.push(<CodeBlock key={key++} code={buf.join("\n")} lang={lang} />);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = [
        "mb-3 mt-6 text-xl font-bold text-neutral-900 first:mt-0",
        "mb-2.5 mt-5 text-lg font-semibold text-neutral-900 first:mt-0",
        "mb-2 mt-4 text-base font-semibold text-neutral-900 first:mt-0",
        "mb-1.5 mt-3.5 text-[15px] font-semibold text-neutral-800",
        "mb-1 mt-3 text-sm font-semibold text-neutral-800",
        "mb-1 mt-3 text-sm font-medium text-neutral-700",
      ][lvl - 1];
      out.push(<div key={key++} className={cls}>{inline(h[2])}</div>);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-5 border-neutral-200" />);
      i++;
      continue;
    }

    // 引用（连续 > 行合并）
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(
        <blockquote key={key++} className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900">
          {buf.map((l, j) => <div key={j}>{inline(l)}</div>)}
        </blockquote>
      );
      continue;
    }

    // 表格：| a | b | 且下一行是分隔行
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (l: string) =>
        l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      out.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>{header.map((c, j) => <th key={j} className="border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-left font-medium text-neutral-800">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-neutral-200 px-2.5 py-1.5">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 无序列表（连续 -/*/+ 行；简单支持两级缩进）
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)!;
        items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[2] });
        i++;
      }
      out.push(
        <ul key={key++} className="my-2 space-y-1">
          {items.map((it, j) => (
            <li key={j} className={`flex gap-2 ${it.depth ? "pl-5" : ""}`}>
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
              <span>{inline(it.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 marker:text-neutral-400">
          {items.map((t, j) => <li key={j}>{inline(t)}</li>)}
        </ol>
      );
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 段落（合并连续非空、非特殊行）
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]); i++;
    }
    out.push(<p key={key++} className="my-2">{inline(buf.join(" "))}</p>);
  }
  return out;
}

/** 行内语法：`code` **bold** *italic* [text](url) ~~del~~ */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) {
      return <code key={i} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-rose-700">{p.slice(1, -1)}</code>;
    }
    if (/^\*\*[^*]+?\*\*$/.test(p)) return <strong key={i} className="font-semibold text-neutral-900">{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+?\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^~~[^~]+?~~$/.test(p)) return <del key={i} className="text-neutral-400">{p.slice(2, -2)}</del>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer"
          className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/* ---------------- 代码高亮（轻量正则实现，无外部依赖） ---------------- */

const KEYWORDS: Record<string, string[]> = {
  js: "const let var function return if else for while do class new import from export default async await try catch finally throw this null undefined true false typeof instanceof in of yield static get set extends".split(" "),
  ts: "const let var function return if else for while do class new import from export default async await try catch finally throw this null undefined true false typeof instanceof in of yield static get set extends interface type enum implements readonly public private protected as satisfies keyof infer".split(" "),
  py: "def return if elif else for while class import from as with try except finally raise lambda None True False self pass break continue global nonlocal yield assert del in is not and or async await print".split(" "),
  sh: "if then else elif fi for while do done case esac function echo exit return export local source cd".split(" "),
  sql: "select from where insert into values update set delete create table drop alter add primary key not null unique index join left right inner outer on as and or in like between order by group having limit offset count sum avg min max distinct".split(" "),
  json: "true false null".split(" "),
  java: "public private protected class interface extends implements static final void int long double float boolean char if else for while do return new this super try catch finally throw throws import package enum record var".split(" "),
  go: "func return if else for range var const type struct interface map chan go defer package import nil true false string int bool error".split(" "),
  rust: "fn let mut const struct enum impl trait match if else for while loop return pub use mod crate self super move ref async await true false Some None Ok Err".split(" "),
  c: "int void char float double long short unsigned signed struct union enum typedef if else for while do return break continue static const extern sizeof switch case default".split(" "),
};
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.jsx = KEYWORDS.js;
KEYWORDS.cxx = KEYWORDS.c;
KEYWORDS.cpp = KEYWORDS.c;
KEYWORDS.h = KEYWORDS.c;
KEYWORDS.hpp = KEYWORDS.c;
KEYWORDS.cs = KEYWORDS.java;
KEYWORDS.php = KEYWORDS.js;
KEYWORDS.kotlin = KEYWORDS.java;
KEYWORDS.kt = KEYWORDS.java;
KEYWORDS.swift = KEYWORDS.java;
KEYWORDS.r = KEYWORDS.py;
KEYWORDS.rb = KEYWORDS.py;

const LANG_ALIAS: Record<string, string> = {
  javascript: "js", typescript: "ts", python: "py", shell: "sh", bash: "sh", zsh: "sh",
  rs: "rust", golang: "go", "c++": "cpp", yml: "json", toml: "json", ini: "json",
};

function langOf(lang: string): string {
  const l = (lang || "").toLowerCase();
  return LANG_ALIAS[l] ?? l;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 把一行代码染色成 HTML：单次扫描替换，避免二次正则破坏已插入的 span 标签 */
function highlightLine(line: string, lang: string): string {
  const kw = KEYWORDS[lang];
  const hashComment = ["py", "sh", "rb", "r", "yaml", "toml"].includes(lang);
  const sqlComment = lang === "sql";
  const commentPart = [
    "\\/\\/[^\\n]*$",
    hashComment ? "#(?!\\{)[^\\n]*$" : null,
    sqlComment ? "--[^\\n]*$" : null,
  ].filter(Boolean).join("|");
  const parts = [
    `(${commentPart})`, // 1 注释
    "(\"[^\"]*\"|'[^']*'|`[^`]*`)", // 2 字符串
    kw?.length ? `\\b(${kw.join("|")})\\b` : null, // 3 关键字
    "\\b(\\d+(?:\\.\\d+)?)\\b", // 4 数字
  ].filter(Boolean);
  const re = new RegExp(parts.join("|"), "g");
  return escapeHtml(line).replace(re, (m, com, str, kwMatch, num) => {
    if (com) return `<span class="hl-com">${com}</span>`;
    if (str) return `<span class="hl-str">${str}</span>`;
    if (kwMatch) return `<span class="hl-kw">${kwMatch}</span>`;
    if (num) return `<span class="hl-num">${num}</span>`;
    return m;
  });
}

/** 带行号和语法高亮的代码块 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const l = langOf(lang ?? "");
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1.5">
        <span className="num text-[11px] uppercase text-neutral-400">{lang || "code"}</span>
        <button
          onClick={() => navigator.clipboard?.writeText(code)}
          className="text-[11px] text-neutral-400 opacity-0 transition-opacity hover:text-neutral-900 group-hover/code:opacity-100"
        >
          复制
        </button>
      </div>
      <pre className="overflow-x-auto bg-white px-4 py-3">
        <code className="font-mono text-[12.5px] leading-6">
          {lines.map((ln, i) => (
            <div key={i} className="flex">
              <span className="num mr-3 w-7 shrink-0 select-none text-right text-neutral-300">{i + 1}</span>
              <span
                className="min-w-0 flex-1 whitespace-pre"
                dangerouslySetInnerHTML={{ __html: highlightLine(ln, l) || "&nbsp;" }}
              />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
