"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";
import UploadModal from "./UploadModal";
import { DND_MIME, readDnd, type DndPayload } from "@/lib/dnd";
import { downloadArtifact } from "@/lib/download";

export type Artifact = {
  id: number; category_id: number | null; type: string; title: string;
  content?: string; source_ids: number[]; model: string | null; created_at: number;
};
type FolderId = number | "ungrouped" | "aigc";
type Folder = { id: FolderId; name: string };

// 不再提供类型下拉：按扩展名自动标注资源类型
function guessType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ppt", "pptx", "pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) return "课件";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(ext)) return "录音";
  if (["txt", "md", "markdown"].includes(ext)) return "笔记";
  return "其他";
}

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 3600_000) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)} 小时前`;
  return `${Math.round(d / 86400_000)} 天前`;
}

type CheckState = "on" | "off" | "partial";

/** 复选框（三态） */
function Check({ state, onClick, title }: { state: CheckState; onClick: (e: React.MouseEvent) => void; title?: string }) {
  return (
    <button
      onClick={onClick} title={title} aria-label={title}
      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors ${
        state === "on"
          ? "border-neutral-900 bg-neutral-900"
          : state === "partial"
            ? "border-neutral-400 bg-neutral-100"
            : "border-neutral-300 bg-white hover:border-neutral-500"
      }`}
    >
      {state === "on" && (
        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "partial" && <span className="h-0.5 w-2 rounded bg-neutral-500" />}
    </button>
  );
}

function checkOf(ids: number[], selected: Set<number>): CheckState {
  if (ids.length === 0) return "off";
  const n = ids.reduce((acc, id) => acc + (selected.has(id) ? 1 : 0), 0);
  return n === 0 ? "off" : n === ids.length ? "on" : "partial";
}

/** 第二栏：类目树（AIGC + 普通类目 + 未归类），支持勾选、拖拽移动、上传 */
export default function FilesPanel({
  sources, artifacts, categories, genError, selected, selectedArts,
  onToggleSource, onToggleFolder, onToggleAll, onToggleArtifact,
  onUpload, onAddLink, onAddText,
  onDeleteSource, onDeleteArtifact, onDeleteCategory, onNewCategory,
  onMoveSource, onMoveArtifact,
  onOpenSource, onOpenArtifact,
}: {
  sources: Source[];
  artifacts: Artifact[];
  categories: { id: number; name: string }[];
  genError: string | null;
  selected: Set<number>;
  /** 已勾选的产物（AIGC/类目里的成果） */
  selectedArts: Set<number>;
  onToggleSource: (id: number) => void;
  onToggleArtifact: (id: number) => void;
  onToggleFolder: (folderId: number | "ungrouped" | "aigc") => void;
  onToggleAll: () => void;
  onUpload: (files: File[], categoryId: number | null, type: string) => Promise<void>;
  onAddLink: (url: string, categoryId: number | null) => Promise<void>;
  onAddText: (text: string, categoryId: number | null) => Promise<void>;
  onDeleteSource: (id: number) => Promise<void>;
  onDeleteArtifact: (id: number) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onNewCategory: (name: string) => Promise<void>;
  onMoveSource: (ids: number[], categoryId: number | null) => Promise<void>;
  onMoveArtifact: (ids: number[], categoryId: number | null) => Promise<void>;
  onOpenSource: (s: Source) => void;
  onOpenArtifact: (a: Artifact) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<FolderId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 上传弹窗（图三形式）
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCat, setUploadCat] = useState<number | null>(null);
  // 新建类目小弹窗
  const [catOpen, setCatOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busyDownload, setBusyDownload] = useState<number | null>(null);

  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };
  const toggle = (k: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const folders: Folder[] = [
    { id: "aigc", name: "AIGC" },
    ...categories.map((c) => ({ id: c.id as FolderId, name: c.name })),
    { id: "ungrouped", name: "未归类" },
  ];

  /** 各文件夹内的资源（用于勾选状态与计数） */
  const folderSources = (id: FolderId): Source[] =>
    id === "aigc" ? []
    : id === "ungrouped" ? sources.filter((s) => s.category_id == null)
    : sources.filter((s) => s.category_id === id);

  const folderArtifacts = (id: FolderId): Artifact[] =>
    id === "aigc" ? artifacts.filter((a) => a.category_id == null)
    : id === "ungrouped" ? []
    : artifacts.filter((a) => a.category_id === id);

  const allSourceIds = sources.map((s) => s.id);
  const allState = checkOf(allSourceIds, selected);
  const selectedSourceIds = new Set(sources.map((s) => s.id).filter((id) => selected.has(id)));

  function openUpload(categoryId: number | null) {
    setUploadCat(categoryId);
    setUploadOpen(true);
  }

  async function doUpload(files: File[], categoryId: number | null) {
    await onUpload(files, categoryId, guessType(files[0]?.name ?? ""));
  }

  async function delCategory(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    await onDeleteCategory(id);
    notify("类目已删除，内容移回未归类");
  }

  async function createCategory() {
    const name = newName.trim();
    if (!name) return;
    await onNewCategory(name);
    setNewName(""); setCatOpen(false);
    notify(`已创建类目「${name}」`);
  }

  function closeCatModal() { setCatOpen(false); setNewName(""); }

  /** 下载产物到本地（.md） */
  async function handleDownload(e: React.MouseEvent, a: Artifact) {
    e.stopPropagation();
    setBusyDownload(a.id);
    try { await downloadArtifact(a.id, a.title); }
    catch (err) { notify(err instanceof Error ? err.message : "下载失败"); }
    finally { setBusyDownload(null); }
  }

  /** 拖拽放置：内部移动（资源/成果）或外部文件上传 */
  async function handleDrop(e: React.DragEvent, target: FolderId) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const payload = readDnd(e.dataTransfer);
    if (payload) {
      await handleInternalDrop(payload, target);
      return;
    }
    if (e.dataTransfer.files.length) {
      if (target === "aigc") { notify("AIGC 仅存放生成的成果，请拖到其他类目上传"); return; }
      await doUpload(Array.from(e.dataTransfer.files), target === "ungrouped" ? null : (target as number));
    }
  }

  async function handleInternalDrop(payload: DndPayload, target: FolderId) {
    if (payload.kind === "source") {
      if (target === "aigc") { notify("AIGC 仅存放生成的成果"); return; }
      await onMoveSource(payload.ids, target === "ungrouped" ? null : (target as number));
      notify(`已移动 ${payload.ids.length} 个资源`);
    } else {
      if (target === "ungrouped") { notify("成果已移回 AIGC"); await onMoveArtifact(payload.ids, null); return; }
      await onMoveArtifact(payload.ids, target === "aigc" ? null : (target as number));
      notify(`已移动 ${payload.ids.length} 个成果`);
    }
  }

  /** 行拖起：拖动已勾选的资源则一次拖走全部勾选项 */
  function startDrag(e: React.DragEvent, payload: DndPayload) {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  }

  function sourceDragPayload(s: Source): DndPayload {
    const ids = selectedSourceIds.has(s.id) && selectedSourceIds.size > 1
      ? Array.from(selectedSourceIds)
      : [s.id];
    return { kind: "source", ids };
  }

  return (
    <aside
      className="flex h-full w-full flex-col border-r border-neutral-300 bg-white"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => {
        e.preventDefault();
        // 背景区域：外部文件 → 未归类；内部拖拽忽略（需落到具体类目）
        if (readDnd(e.dataTransfer)) { setDragOver(null); return; }
        if (e.dataTransfer.files.length) {
          doUpload(Array.from(e.dataTransfer.files), null);
        }
      }}
    >
      {/* 顶部：上传入口 + 全选 */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-300 px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-900"
          title="全选 / 取消全选资源">
          <Check state={allState} onClick={(e) => { e.stopPropagation(); onToggleAll(); }} title="全选" />
          全选
        </label>
        <button onClick={() => openUpload(null)}
          className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-700">
          ＋ 上传
        </button>
      </div>

      {genError && (
        <div className="mx-3 mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{genError}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            资源 <span className="num">{sources.length}</span>
          </span>
          <button onClick={() => setCatOpen(true)} className="text-[11px] text-neutral-400 hover:text-neutral-900">＋ 新建类目</button>
        </div>

        {/* 类目树 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {folders.map((f) => {
            const key = String(f.id);
            const isOpen = expanded.has(key);
            const srcs = folderSources(f.id);
            const arts = folderArtifacts(f.id);
            const items = srcs.length + arts.length;
            const isAigc = f.id === "aigc";
            // 类目选中态：资源（selected）+ 产物（selectedArts）合并计算
            const onCount =
              srcs.reduce((n, s) => n + (selected.has(s.id) ? 1 : 0), 0) +
              arts.reduce((n, a) => n + (selectedArts.has(a.id) ? 1 : 0), 0);
            const cState: CheckState = items === 0 || onCount === 0 ? "off" : onCount === items ? "on" : "partial";
            return (
              <div key={key}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(f.id); }}
                onDragLeave={() => setDragOver((cur) => (cur === f.id ? null : cur))}
                onDrop={(e) => void handleDrop(e, f.id)}
              >
                <div className={`group flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 ${
                  dragOver === f.id ? "bg-neutral-100 ring-1 ring-neutral-300" : "hover:bg-neutral-50"}`}>
                  <Check
                    state={cState}
                    title={cState === "on" ? "取消选择" : "选中该类目全部内容"}
                    onClick={(e) => { e.stopPropagation(); onToggleFolder(f.id as number | "ungrouped" | "aigc"); }}
                  />
                  <button onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                    <svg className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="M4 2.5 8.5 6 4 9.5" />
                    </svg>
                    {isAigc && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-violet-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                        <path d="M8 1.5 9.4 5l3.6.3-2.7 2.4.8 3.5L8 9.4l-3.9 1.8.8-3.5L2.2 5.3 5.8 5 8 1.5Z" strokeLinejoin="round" />
                      </svg>
                    )}
                    <span className={`truncate text-[13px] font-medium ${isAigc ? "text-violet-700" : "text-neutral-700"}`}>{f.name}</span>
                    <span className="num text-[11px] text-neutral-400">{items}</span>
                  </button>
                  {typeof f.id === "number" && (() => {
                    const numId = f.id as number;
                    return (
                      <button onClick={(e) => delCategory(e, numId)} title="删除类目（内容移回未归类）"
                        className="hidden shrink-0 px-1 text-[11px] text-neutral-300 hover:text-red-600 group-hover:block">删</button>
                    );
                  })()}
                  {!isAigc && (
                    <button onClick={() => openUpload(f.id === "ungrouped" ? null : (f.id as number))} title="上传到此类目"
                      className="hidden shrink-0 px-1 text-[11px] text-neutral-300 hover:text-neutral-900 group-hover:block">＋</button>
                  )}
                </div>
                {isOpen && (
                  <div className="ml-4 border-l border-neutral-100 pl-1.5">
                    {items === 0 && (
                      <p className="px-2 py-1.5 text-[11px] text-neutral-300">
                        {dragOver === f.id ? "松开放入此处" : isAigc ? "暂无成果" : "空 · 可拖文件或资源进来"}
                      </p>
                    )}
                    {/* 资源条目 */}
                    {srcs.map((s) => (
                      <div key={`s${s.id}`}
                        draggable
                        onDragStart={(e) => startDrag(e, sourceDragPayload(s))}
                        onClick={() => onOpenSource(s)}
                        title={s.note ?? undefined}
                        className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-neutral-50 ${
                          selected.has(s.id) ? "bg-neutral-100" : ""
                        }`}>
                        <Check state={selected.has(s.id) ? "on" : "off"} title="选中用于对话"
                          onClick={(e) => { e.stopPropagation(); onToggleSource(s.id); }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] leading-4 text-neutral-700">{s.title}</div>
                          <div className="num mt-0.5 text-[10px] text-neutral-400">
                            {s.type} · {s.chunk_count > 0 ? `${s.chunk_count} 块 · ` : ""}{timeAgo(s.created_at)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteSource(s.id); }}
                          title="删除"
                          className="hidden shrink-0 px-0.5 text-[11px] text-neutral-300 hover:text-red-600 group-hover:block">删</button>
                      </div>
                    ))}
                    {/* 成果条目（可拖到其他类目） */}
                    {arts.map((a) => (
                      <div key={`a${a.id}`}
                        draggable
                        onDragStart={(e) => startDrag(e, { kind: "artifact", ids: [a.id] })}
                        onClick={() => onOpenArtifact(a)}
                        className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-neutral-50 ${
                          selectedArts.has(a.id) ? "bg-neutral-100" : ""
                        }`}>
                        <Check state={selectedArts.has(a.id) ? "on" : "off"} title="选中用于生成/对话"
                          onClick={(e) => { e.stopPropagation(); onToggleArtifact(a.id); }} />
                        <svg className="h-3 w-3 shrink-0 text-violet-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <path d="M4 2h5l3 3v9H4V2Z" /><path d="M9 2v3h3" />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] leading-4 text-neutral-700">{a.title}</div>
                          <div className="num mt-0.5 text-[10px] text-neutral-400">
                            {a.model === "mock" ? "演示" : a.model} · {a.source_ids.length} 来源 · {timeAgo(a.created_at)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => void handleDownload(e, a)}
                          disabled={busyDownload === a.id}
                          title="下载到本地（.md）"
                          className="hidden shrink-0 px-0.5 text-[11px] text-neutral-300 hover:text-neutral-900 group-hover:block disabled:opacity-50">
                          {busyDownload === a.id ? "…" : "⤓"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteArtifact(a.id); }}
                          title="删除"
                          className="hidden shrink-0 px-0.5 text-[11px] text-neutral-300 hover:text-red-600 group-hover:block">删</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 上传弹窗 */}
      <UploadModal
        open={uploadOpen}
        defaultCategoryId={uploadCat}
        categories={categories}
        onClose={() => setUploadOpen(false)}
        onUpload={doUpload}
        onAddLink={onAddLink}
        onAddText={onAddText}
      />

      {/* 新建类目小弹窗 */}
      {catOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeCatModal}>
          <div className="w-[300px] rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-medium">新建类目</h3>
            <input
              autoFocus value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCategory();
                if (e.key === "Escape") closeCatModal();
              }}
              placeholder="输入类目名，Enter 创建"
              className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeCatModal}
                className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-50">
                取消
              </button>
              <button onClick={createCategory} disabled={!newName.trim()}
                className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>
      )}
    </aside>
  );
}
