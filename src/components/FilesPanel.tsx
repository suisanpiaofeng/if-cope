"use client";

import { useState, type ReactNode } from "react";
import type { Source } from "@/lib/types";
import UploadModal from "./UploadModal";
import { Markdown } from "./Markdown";
import { DND_MIME, readDnd, type DndPayload } from "@/lib/dnd";
import { downloadArtifact } from "@/lib/download";

export type Artifact = {
  id: number; category_id: number | null; type: string; title: string;
  content?: string; source_ids: number[]; model: string | null; created_at: number;
};
type FolderId = number | "ungrouped";
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

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2.5 4h11M6.5 4V2.8c0-.4.3-.8.8-.8h1.4c.5 0 .8.4.8.8V4" strokeLinecap="round" />
      <path d="M5.5 4l.5 9c0 .5.4.8.8.8h2.4c.4 0 .8-.3.8-.8l.5-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 6.8v4.4M9.2 6.8v4.4" strokeLinecap="round" />
    </svg>
  );
}

function SubCatIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M2 4.2c0-.5.4-.9.9-.9h2.7l1.2 1.4h6.3c.5 0 .9.4.9.9v1H2v-2.4Z" />
      <path d="M3.2 7.6h9.6l-.7 4.9c-.05.4-.4.7-.8.7H4.7c-.4 0-.75-.3-.8-.7l-.7-4.9Z" />
      <path d="M8 8.7v3M6.5 10.2h3" strokeLinecap="round" />
    </svg>
  );
}

/** 第二栏：类目树（普通类目 + 未归类），支持勾选、拖拽移动、上传。
 *  各页视图差异通过 props 实现：传入预过滤的 sources/artifacts（翻译页只传 PDF、解题页只传 ready），
 *  特有区块用插槽挂载（topSlot=解题页地图管理，bottomSlot=翻译历史/批量按钮，topBarExtra=页内快捷钮）。 */
export default function FilesPanel({
  sources, artifacts, categories, genError, selected, selectedArts,
  onToggleSource, onToggleFolder, onToggleAll, onToggleArtifact,
  onUpload, onAddLink, onAddText,
  onDeleteSource, onDeleteArtifact, onDeleteCategory, onNewCategory,
  onMoveSource, onMoveArtifact,
  onOpenSource, onOpenArtifact,
  sectionTitle = "资源",
  topSlot, bottomSlot, topBarExtra, emptyText,
  sourceMeta, sourceBadge, sourceRowClass,
}: {
  sources: Source[];
  artifacts: Artifact[];
  categories: { id: number; name: string; parent_id: number | null; pinned?: number }[];
  genError: string | null;
  selected: Set<number>;
  /** 已勾选的产物（生成的内容，默认在未归类） */
  selectedArts: Set<number>;
  onToggleSource: (id: number) => void;
  onToggleArtifact: (id: number) => void;
  onToggleFolder: (folderId: number | "ungrouped") => void;
  onToggleAll: () => void;
  onUpload: (files: File[], categoryId: number | null, type: string, opts?: { path?: string; autoIndex?: boolean }) => Promise<void>;
  onAddLink: (url: string, categoryId: number | null) => Promise<void>;
  onAddText: (text: string, categoryId: number | null) => Promise<void>;
  onDeleteSource: (id: number) => Promise<void>;
  onDeleteArtifact: (id: number) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onNewCategory: (name: string, parentId: number | null) => Promise<void>;
  onMoveSource: (ids: number[], categoryId: number | null) => Promise<void>;
  onMoveArtifact: (ids: number[], categoryId: number | null) => Promise<void>;
  onOpenSource: (s: Source) => void;
  /** 点产物行：未传时用内置预览弹窗（翻译/解题页统一预览）；工作台传自己的标签页逻辑 */
  onOpenArtifact?: (a: Artifact) => void;
  /** 区块标题（默认「资源」；翻译页传「待翻译资源」等） */
  sectionTitle?: string;
  /** 资源区上方插槽（解题页：知识地图管理） */
  topSlot?: ReactNode;
  /** 资源区下方插槽（翻译页：批量翻译按钮 + 历史；解题页：提示语） */
  bottomSlot?: ReactNode;
  /** 顶栏（全选/上传那行）中间插槽：页内快捷钮（选英文文献/清空等） */
  topBarExtra?: ReactNode;
  /** 资源为空时的提示文案 */
  emptyText?: string;
  /** 资源行副标题定制（默认「类型 · N块 · 时间」；翻译页可改为只显示 PDF 标识） */
  sourceMeta?: (s: Source) => ReactNode;
  /** 资源行尾部徽标（如翻译页的疑似英文文献 🌐） */
  sourceBadge?: (s: Source) => ReactNode;
  /** 资源行附加样式（如翻译页的蓝色左边界高亮） */
  sourceRowClass?: (s: Source) => string;
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
  const [newCatParent, setNewCatParent] = useState<number | null>(null);
  const [busyDownload, setBusyDownload] = useState<number | null>(null);
  // 内置产物预览弹窗（onOpenArtifact 未传时的统一预览）
  const [previewArt, setPreviewArt] = useState<Artifact | null>(null);
  const [previewData, setPreviewData] = useState<{ content: string; model: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function openBuiltInPreview(a: Artifact) {
    setPreviewArt(a);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const r = await fetch(`/api/artifacts/${a.id}`);
      const d = await r.json();
      setPreviewData({ content: String(d.content ?? ""), model: String(d.model ?? "") });
    } catch {
      setPreviewData({ content: "（读取失败）", model: "" });
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleOpenArtifact(a: Artifact) {
    if (onOpenArtifact) onOpenArtifact(a);
    else void openBuiltInPreview(a);
  }

  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };
  const toggle = (k: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  /** 类目树：按父子关系展开，未归类垫底（生成的内容默认落未归类，可拖入任意类目） */
  const childrenOf = (pid: number) => categories.filter((c) => c.parent_id === pid);
  const folders: (Folder & { depth: number })[] = [];
  for (const c of categories.filter((x) => x.parent_id == null)) {
    folders.push({ id: c.id, name: c.name, depth: 0 });
    for (const ch of childrenOf(c.id)) folders.push({ id: ch.id, name: ch.name, depth: 1 });
  }
  folders.push({ id: "ungrouped", name: "未归类", depth: 0 });

  /** 各文件夹内的资源 / 产物（未归类对两者一视同仁） */
  const folderSources = (id: FolderId): Source[] =>
    id === "ungrouped" ? sources.filter((s) => s.category_id == null)
    : sources.filter((s) => s.category_id === id);

  const folderArtifacts = (id: FolderId): Artifact[] =>
    id === "ungrouped" ? artifacts.filter((a) => a.category_id == null)
    : artifacts.filter((a) => a.category_id === id);

  const allSourceIds = sources.map((s) => s.id);
  const allState = checkOf(allSourceIds, selected);
  const selectedSourceIds = new Set(sources.map((s) => s.id).filter((id) => selected.has(id)));

  function openUpload(categoryId: number | null) {
    setUploadCat(categoryId);
    setUploadOpen(true);
  }

  async function doUpload(files: File[], categoryId: number | null, opts?: { path?: string; autoIndex?: boolean }) {
    await onUpload(files, categoryId, guessType(files[0]?.name ?? ""), opts);
  }

  async function delCategory(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    await onDeleteCategory(id);
    notify("类目已删除，内容移回未归类");
  }

  async function createCategory() {
    const name = newName.trim();
    if (!name) return;
    await onNewCategory(name, newCatParent);
    setNewName(""); setCatOpen(false); setNewCatParent(null);
    notify(`已创建${newCatParent != null ? "子" : ""}类目「${name}」`);
  }

  function closeCatModal() { setCatOpen(false); setNewName(""); setNewCatParent(null); }

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
      await doUpload(Array.from(e.dataTransfer.files), target === "ungrouped" ? null : (target as number));
    }
  }

  async function handleInternalDrop(payload: DndPayload, target: FolderId) {
    // 所有类目平权：资源与产物都可放入任意类目（含未归类）
    const catId = target === "ungrouped" ? null : (target as number);
    if (payload.kind === "source") {
      await onMoveSource(payload.ids, catId);
      notify(`已移动 ${payload.ids.length} 个资源`);
    } else {
      await onMoveArtifact(payload.ids, catId);
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
        <div className="flex items-center gap-2">
          {topBarExtra}
          <button onClick={() => openUpload(null)}
            className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-700">
            ＋ 上传
          </button>
        </div>
      </div>

      {genError && (
        <div className="mx-3 mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{genError}</div>
      )}

      {topSlot}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            {sectionTitle} <span className="num">{sources.length}</span>
          </span>
          <button onClick={() => { setNewCatParent(null); setCatOpen(true); }} className="text-[11px] text-neutral-400 hover:text-neutral-900">＋ 新建类目</button>
        </div>

        {/* 类目树 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sources.length + artifacts.length === 0 && emptyText ? (
            <p className="px-2 py-2 text-[11px] text-neutral-300">{emptyText}</p>
          ) : folders.map((f) => {
            const key = String(f.id);
            const isOpen = expanded.has(key);
            const srcs = folderSources(f.id);
            const arts = folderArtifacts(f.id);
            const items = srcs.length + arts.length;
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
                <div style={{ marginLeft: (f.depth ?? 0) * 14 }} className={`group flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 ${
                  dragOver === f.id ? "bg-neutral-100 ring-1 ring-neutral-300" : "hover:bg-neutral-50"}`}>
                  <Check
                    state={cState}
                    title={cState === "on" ? "取消选择" : "选中该类目全部内容"}
                    onClick={(e) => { e.stopPropagation(); onToggleFolder(f.id as number | "ungrouped"); }}
                  />
                  <button onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                    <svg className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="M4 2.5 8.5 6 4 9.5" />
                    </svg>
                    <span className="truncate text-[13px] font-medium text-neutral-700">{f.name}</span>
                    <span className="num text-[11px] text-neutral-400">{items}</span>
                  </button>
                  {typeof f.id === "number" && (
                    <button onClick={(e) => delCategory(e, f.id as number)} title="删除类目（内容回未归类）"
                      className="hidden shrink-0 px-1 text-neutral-300 hover:text-red-600 group-hover:block"><TrashIcon /></button>
                  )}
                  {typeof f.id === "number" && (
                    <button onClick={(e) => { e.stopPropagation(); setNewCatParent(f.id as number); setCatOpen(true); }} title="新建子类目"
                      className="hidden shrink-0 px-1 text-neutral-300 hover:text-neutral-900 group-hover:block"><SubCatIcon /></button>
                  )}
                  <button onClick={() => openUpload(f.id === "ungrouped" ? null : (f.id as number))} title="上传到此类目"
                    className="hidden shrink-0 px-1 text-[11px] text-neutral-300 hover:text-neutral-900 group-hover:block">＋</button>
                </div>
                {isOpen && (
                  <div className="ml-4 border-l border-neutral-100 pl-1.5">
                    {items === 0 && (
                      <p className="px-2 py-1.5 text-[11px] text-neutral-300">
                        {dragOver === f.id ? "松开放入此处" : "空 · 可拖文件、资源或成果进来"}
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
                        } ${sourceRowClass?.(s) ?? ""}`}>
                        <Check state={selected.has(s.id) ? "on" : "off"} title="选中用于对话"
                          onClick={(e) => { e.stopPropagation(); onToggleSource(s.id); }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] leading-4 text-neutral-700">{s.title}</div>
                          {sourceMeta ? (
                            <div className="num mt-0.5 text-[10px] text-neutral-400">{sourceMeta(s)}</div>
                          ) : (
                            <div className="num mt-0.5 text-[10px] text-neutral-400">
                              {s.type} · {s.chunk_count > 0 ? `${s.chunk_count} 块 · ` : ""}{timeAgo(s.created_at)}
                            </div>
                          )}
                        </div>
                        {sourceBadge?.(s)}
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteSource(s.id); }}
                          title="删除"
                          className="hidden shrink-0 px-0.5 text-neutral-300 hover:text-red-600 group-hover:block"><TrashIcon /></button>
                      </div>
                    ))}
                    {/* 成果条目（可拖到其他类目） */}
                    {arts.map((a) => (
                      <div key={`a${a.id}`}
                        draggable
                        onDragStart={(e) => startDrag(e, { kind: "artifact", ids: [a.id] })}
                        onClick={() => handleOpenArtifact(a)}
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
                          className="hidden shrink-0 px-0.5 text-neutral-300 hover:text-red-600 group-hover:block"><TrashIcon /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {bottomSlot}

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
            <h3 className="text-sm font-medium">新建{newCatParent != null ? "子" : ""}类目</h3>
            {newCatParent != null && (
              <p className="mt-1 text-[11px] text-neutral-400">
                父类目：「{categories.find((c) => c.id === newCatParent)?.name ?? ""}」
              </p>
            )}
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

      {/* 内置产物预览弹窗（统一预览：笔记 Markdown / 译文 PDF / 知识地图 / 文本翻译对照） */}
      {previewArt && (
        <ArtifactPreviewModal
          art={previewArt}
          data={previewData}
          loading={previewLoading}
          onClose={() => { setPreviewArt(null); setPreviewData(null); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>
      )}
    </aside>
  );
}

/** 产物统一预览弹窗：所有页面共用的预览界面。
 *  按产物内容自动选渲染器：笔记/摘要 → Markdown；PDF 译文 → iframe；
 *  文本翻译 → 原译双栏；知识地图 → 卡片摘要列表；其他 → 原文文本。 */
function ArtifactPreviewModal({ art, data, loading, onClose }: {
  art: Artifact;
  data: { content: string; model: string } | null;
  loading: boolean;
  onClose: () => void;
}) {
  let body: ReactNode = null;
  if (loading) {
    body = <p className="py-10 text-center text-xs text-neutral-400">读取中…</p>;
  } else if (data) {
    try {
      const parsed = JSON.parse(data.content) as Record<string, unknown>;
      if (parsed.kind === "pdf") {
        // PDF 译文：iframe 直读（译文已入库资源也可从资源行预览）
        body = (
          <iframe
            src={`/api/translations/${art.id}?which=mono`}
            title={art.title}
            className="h-full min-h-0 w-full border-0"
          />
        );
      } else if (Array.isArray(parsed.segments)) {
        // 文本翻译：原译双栏
        const segs = parsed.segments as Array<{ src?: string; trg?: string; page?: number | null; heading?: string | null }>;
        body = (
          <div className="h-full overflow-y-auto px-4 py-3">
            {segs.map((s, i) => (
              <div key={i} className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-neutral-100">
                <div className="px-3 py-2 text-[11px] leading-5 whitespace-pre-wrap text-neutral-500">{s.src}</div>
                <div className="border-l border-neutral-100 px-3 py-2 text-[11px] leading-5 whitespace-pre-wrap text-neutral-800">{s.trg}</div>
              </div>
            ))}
          </div>
        );
      } else if (Array.isArray(parsed.nodes)) {
        // 知识地图：卡片摘要
        const nodes = parsed.nodes as Array<{ title?: string; question?: string; answer?: string }>;
        body = (
          <div className="h-full overflow-y-auto px-4 py-3">
            <p className="mb-2 text-[11px] text-neutral-400">共 {nodes.length} 张卡片 · 完整地图请到「解题答疑」页打开</p>
            {nodes.map((n, i) => (
              <div key={i} className="mb-1.5 rounded-lg border border-neutral-100 px-3 py-2">
                <div className="text-[12px] font-medium text-neutral-800">{n.title ?? `卡片 ${i + 1}`}</div>
                {n.answer && <div className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{n.answer}</div>}
              </div>
            ))}
          </div>
        );
      } else {
        body = <FallbackText text={data.content} />;
      }
    } catch {
      // 非 JSON：按 Markdown 渲染（笔记/摘要等）
      body = (
        <div className="h-full overflow-y-auto px-4 py-3">
          <FallbackText text={data.content} />
        </div>
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 py-8" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[860px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <svg className="h-3.5 w-3.5 shrink-0 text-violet-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 2h5l3 3v9H4V2Z" /><path d="M9 2v3h3" />
            </svg>
            <span className="truncate text-[14px] font-semibold">{art.title}</span>
            <span className="num shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              {ART_TYPE_LABEL[art.type] ?? art.type}
              {data?.model && data.model !== "mock" ? ` · ${data.model}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void downloadArtifact(art.id, art.title)}
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
            >
              ⤓ 下载
            </button>
            <button onClick={onClose} className="px-1.5 text-neutral-400 hover:text-neutral-900">✕</button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    </div>
  );
}

function FallbackText({ text }: { text: string }) {
  return <Markdown text={text} />;
}

const ART_TYPE_LABEL: Record<string, string> = {
  summary: "复习笔记",
  translation: "翻译",
  "qa-map": "知识地图",
};
