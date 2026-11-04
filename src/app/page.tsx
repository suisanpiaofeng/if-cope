"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import FilesPanel, { type Artifact } from "@/components/FilesPanel";
import PreviewPanel, { type PreviewTab, type SaveFileResult } from "@/components/PreviewPanel";
import ChatPanel from "@/components/ChatPanel";
import type { Source } from "@/lib/types";
import { useLibrary } from "@/lib/useLibrary";
import { filePreviewKind } from "@/lib/preview";

export default function Workspace() {
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [generatingNote, setGeneratingNote] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeMsg, setOrganizeMsg] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  // 可拖动的分栏宽度
  const [filesW, setFilesW] = useState(264);
  const [chatW, setChatW] = useState(340);

  // 共享资源库（第二栏数据/操作单点实现，翻译/解题页同源）；删资源时同步关预览标签
  const lib = useLibrary({
    onSourceRemoved: (id) => setTabs((t) => t.filter((x) => x.key !== `source-${id}`)),
    onArtifactRemoved: (id) => setTabs((t) => t.filter((x) => x.key !== `artifact-${id}`)),
  });
  const { sources, artifacts, categories, selected, selectedArts } = lib;
  const genError = lib.genError;
  const setGenError = lib.setGenError;

  function startResize(e: React.PointerEvent, which: "files" | "chat") {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = which === "files" ? filesW : chatW;
    const dir = which === "files" ? 1 : -1; // 对话栏在右侧，往左拖是加宽
    const min = which === "files" ? 200 : 280;
    const max = which === "files" ? 420 : 560;
    const set = which === "files" ? setFilesW : setChatW;
    const move = (ev: PointerEvent) =>
      set(Math.min(max, Math.max(min, w0 + dir * (ev.clientX - x0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const load = lib.load;

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setConfigured(d.hasKey && Boolean(d.baseUrl && d.chatModel)));
  }, []);

  // ---------- 预览标签 ----------
  // 编辑保存：写回原始文件 + 重建索引，并同步更新标签里的文本
  async function saveFileText(id: number, text: string): Promise<SaveFileResult> {
    const res = await fetch(`/api/sources/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json()) as SaveFileResult;
    if (!res.ok || data.error) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    setTabs((t) => t.map((x) => (x.kind === "file" && x.id === id ? { ...x, text } : x)));
    await load(); // 刷新资源列表（chunk_count 变了）
    return data;
  }

  function openSource(s: Source) {
    const key = `source-${s.id}`;
    if (tabs.some((t) => t.key === key)) { setActiveKey(key); return; }

    // 网页链接：爬取正文展示
    if (s.source_type === "link") {
      setTabs((t) => [...t, { key, kind: "file", fileType: "site", ext: "url", id: s.id, title: s.title, loading: true }]);
      setActiveKey(key);
      fetch(`/api/preview/${s.id}`)
        .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error ?? `HTTP ${r.status}`)))))
        .then((d) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, text: d.text, error: d.warning ? `⚠ ${d.warning}` : undefined } : x)))
        .catch((err) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, error: `爬取失败：${err instanceof Error ? err.message : String(err)}` } : x)));
      return;
    }

    // 优先原始文件预览（markdown/图片/代码/txt/pdf/docx），失败或不支持时回退解析文本
    const kind = s.source_type === "file" ? filePreviewKind(s.ext) : null;
    if (kind) {
      const streaming = kind === "image" || kind === "pdf"; // 浏览器原生渲染，无需取文本
      setTabs((t) => [...t, { key, kind: "file", fileType: kind, ext: s.ext, id: s.id, title: s.title, loading: !streaming }]);
      setActiveKey(key);
      if (!streaming) {
        fetch(`/api/preview/${s.id}`)
          .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error ?? `HTTP ${r.status}`)))))
          .then((d) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, text: d.text, html: d.html } : x)))
          .catch((err) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, error: `读取原始文件失败：${err instanceof Error ? err.message : String(err)}` } : x)));
      }
      return;
    }

    setTabs((t) => [...t, { key, kind: "source", id: s.id, title: s.title, loading: true }]);
    setActiveKey(key);
    fetch(`/api/lookup?sourceId=${s.id}`)
      .then((r) => r.json())
      .then((d) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, chunks: d.chunks } : x)));
  }

  function openArtifact(a: Artifact) {
    const key = `artifact-${a.id}`;
    if (tabs.some((t) => t.key === key)) { setActiveKey(key); return; }
    setTabs((t) => [...t, { key, kind: "artifact", id: a.id, title: a.title, artifactType: a.type, loading: true }]);
    setActiveKey(key);
    fetch(`/api/artifacts/${a.id}`)
      .then((r) => r.json())
      .then((d) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, markdown: d.content, artifactType: d.type } : x)));
  }

  /** 便签生成：基于当前选中（或全部）资源生成结构化产物并打开预览 */
  async function handleGenerateNote(kind: string) {
    if (generatingNote) return;
    setGeneratingNote(kind);
    setGenError(null);
    try {
      const ids = selected.size > 0
        ? [...selected]
        : sources.filter((s) => s.status === "ready").map((s) => s.id);
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: ids, artifactIds: [...selectedArts], kind }),
      });
      const d = (await res.json()) as Artifact & { error?: string };
      if (!res.ok) throw new Error(d.error || "生成失败");
      await load();
      openArtifact(d);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingNote(null);
    }
  }

  /** 快捷功能：自动整理资源（模型归类 → 建类目 → 资源归位） */
  async function organizeResources() {
    if (organizing) return;
    setOrganizing(true);
    setGenError(null);
    try {
      const res = await fetch("/api/organize", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "整理失败");
      await load();
      const parts = [`移动 ${d.moved ?? 0} 份`, `复用已有类目 ${d.reused ?? 0} 个`];
      if (d.created?.length) parts.push(`新建 ${d.created.length} 个（${d.created.join("、")}）`);
      if (d.cleaned?.length) parts.push(`清理空类目 ${d.cleaned.length} 个（${d.cleaned.join("、")}）`);
      setOrganizeMsg(`整理完成：${parts.join(" · ")}`);
      setTimeout(() => setOrganizeMsg(null), 12000);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrganizing(false);
    }
  }

  /** 打开解题答疑（独立功能页） */
  function openSolve() {
    window.location.href = "/solve";
  }

  /** 引用跳转：按 sourceId 打开源预览 */
  function openSourceById(id: number) {
    const s = sources.find((x) => x.id === id);
    if (s) openSource(s);
  }

  useEffect(() => {
    // 深链：/?openSource=<id> —— 解题答疑页引用跳转过来时直接打开该源
    const openId = new URLSearchParams(window.location.search).get("openSource");
    if (openId) {
      const s = sources.find((x) => x.id === Number(openId));
      if (s) openSource(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length]);

  function closeTab(key: string) {
    setTabs((t) => {
      const next = t.filter((x) => x.key !== key);
      if (activeKey === key) setActiveKey(next[next.length - 1]?.key ?? null);
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={configured} />

      <div className="shrink-0" style={{ width: filesW }}>
        <FilesPanel
          sources={sources}
          artifacts={artifacts}
          categories={categories}
          genError={genError}
          selected={selected}
          selectedArts={selectedArts}
          onToggleSource={lib.toggleSelect}
          onToggleArtifact={lib.toggleSelectArtifact}
          onToggleFolder={lib.toggleFolderSelect}
          onToggleAll={lib.toggleSelectAll}
          onUpload={lib.upload}
          onAddLink={lib.addLink}
          onAddText={lib.addText}
          onDeleteSource={lib.removeSource}
          onDeleteArtifact={lib.removeArtifact}
          onDeleteCategory={lib.removeCategory}
          onNewCategory={lib.newCategory}
          onMoveSource={lib.moveSource}
          onMoveArtifact={lib.moveArtifact}
          onOpenSource={openSource}
          onOpenArtifact={openArtifact}
        />
      </div>

      <Divider onPointerDown={(e) => startResize(e, "files")} />

      <main className="flex min-w-0 flex-1 flex-col">
        <PreviewPanel
          tabs={tabs}
          activeKey={activeKey}
          onSelect={setActiveKey}
          onClose={closeTab}
          onSaveFile={saveFileText}
          onOpenSourceById={openSourceById}
        />
      </main>

      <Divider onPointerDown={(e) => startResize(e, "chat")} />

      <div className="shrink-0" style={{ width: chatW }}>
        <ChatPanel
          sources={sources}
          selected={selected}
          onSelectionReset={lib.clearSelection}
          onGenerateNote={handleGenerateNote}
          generatingNote={generatingNote}
          onOrganize={organizeResources}
          organizing={organizing}
          organizeMsg={organizeMsg}
          onOpenSolve={openSolve}
        />
      </div>
    </div>
  );
}

/** 栏间分界线：占位净宽为 0（w-2 被 -mx-1 抵消），分隔线仅悬停时显示，避免与面板边框叠成双线 */
function Divider({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div onPointerDown={onPointerDown}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-400" />
    </div>
  );
}

