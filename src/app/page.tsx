"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import FilesPanel, { type Artifact } from "@/components/FilesPanel";
import PreviewPanel, { type PreviewTab, type SaveFileResult } from "@/components/PreviewPanel";
import ChatPanel from "@/components/ChatPanel";
import type { Source } from "@/lib/types";
import { filePreviewKind } from "@/lib/preview";

type Category = { id: number; name: string };

export default function Workspace() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 勾选的资源（对话上下文之一；发送后清空）
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [genError, setGenError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  // 可拖动的分栏宽度
  const [filesW, setFilesW] = useState(264);
  const [chatW, setChatW] = useState(340);

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

  const load = useCallback(async () => {
    const [srcRes, artRes] = await Promise.all([
      fetch("/api/sources"),
      fetch("/api/artifacts?categoryId=all"),
    ]);
    const data = await srcRes.json();
    setSources(data.sources);
    setCategories(data.categories);
    setArtifacts((await artRes.json()).artifacts);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setConfigured(d.hasKey && Boolean(d.baseUrl && d.chatModel)));
  }, []);

  // ---------- 勾选（对话上下文） ----------
  function toggleSelect(id: number) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleFolderSelect(folderId: number | "ungrouped") {
    const ids = sources
      .filter((s) => (folderId === "ungrouped" ? s.category_id == null : s.category_id === folderId))
      .map((s) => s.id);
    setSelected((prev) => {
      const n = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => n.has(id));
      ids.forEach((id) => (allOn ? n.delete(id) : n.add(id)));
      return n;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === sources.length ? new Set() : new Set(sources.map((s) => s.id))));
  }

  // ---------- 文件操作 ----------
  async function upload(files: File[], categoryId: number | null, type: string) {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      if (categoryId != null) fd.append("categoryId", String(categoryId));
      fd.append("type", type);
      try {
        const res = await fetch("/api/sources", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) setGenError(data.error ?? `《${f.name}》上传失败（HTTP ${res.status}）`);
        else if (data.duplicate) setGenError(data.message);
        else if (data.status === "failed") setGenError(`《${f.name}》解析失败：${data.note ?? "未知原因"}`);
      } catch (err) {
        setGenError(`《${f.name}》上传失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await load();
  }

  async function addLink(url: string, categoryId: number | null) {
    try {
      const res = await fetch("/api/sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, categoryId: categoryId ?? undefined }),
      });
      const data = await res.json();
      if (data.error) setGenError(data.error);
      else if (data.duplicate) setGenError(data.message);
      else if (data.status === "failed") setGenError(`网页解析失败：${data.note ?? "未知原因"}`);
    } catch (err) {
      setGenError(`网页收藏失败：${err instanceof Error ? err.message : String(err)}`);
    }
    await load();
  }

  // 粘贴文本入库（上传弹窗「复制的文字」模式）
  async function addText(text: string, categoryId: number | null) {
    try {
      const res = await fetch("/api/sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, categoryId: categoryId ?? undefined }),
      });
      const data = await res.json();
      if (data.error) setGenError(data.error);
      else if (data.duplicate) setGenError(data.message);
      else if (data.status === "failed") setGenError(`文本解析失败：${data.note ?? "未知原因"}`);
    } catch (err) {
      setGenError(`文本添加失败：${err instanceof Error ? err.message : String(err)}`);
    }
    await load();
  }

  async function removeSource(id: number) {
    await fetch(`/api/sources/${id}`, { method: "DELETE" });
    setTabs((t) => t.filter((x) => x.key !== `source-${id}`));
    await load();
  }

  async function removeArtifact(id: number) {
    await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
    setTabs((t) => t.filter((x) => x.key !== `artifact-${id}`));
    await load();
  }

  async function removeCategory(id: number) {
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    await load();
  }

  async function newCategory(name: string) {
    await fetch("/api/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await load();
  }

  // ---------- 拖拽移动（资源 / 成果 换类目） ----------
  async function moveSource(ids: number[], categoryId: number | null) {
    for (const id of ids) {
      await fetch(`/api/sources/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
    }
    await load();
  }

  async function moveArtifact(ids: number[], categoryId: number | null) {
    for (const id of ids) {
      await fetch(`/api/artifacts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
    }
    await load();
  }

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
    setTabs((t) => [...t, { key, kind: "artifact", id: a.id, title: a.title, loading: true }]);
    setActiveKey(key);
    fetch(`/api/artifacts/${a.id}`)
      .then((r) => r.json())
      .then((d) => setTabs((t) => t.map((x) => x.key === key ? { ...x, loading: false, markdown: d.content } : x)));
  }

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
          onToggleSource={toggleSelect}
          onToggleFolder={toggleFolderSelect}
          onToggleAll={toggleSelectAll}
          onUpload={upload}
          onAddLink={addLink}
          onAddText={addText}
          onDeleteSource={removeSource}
          onDeleteArtifact={removeArtifact}
          onDeleteCategory={removeCategory}
          onNewCategory={newCategory}
          onMoveSource={moveSource}
          onMoveArtifact={moveArtifact}
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
        />
      </main>

      <Divider onPointerDown={(e) => startResize(e, "chat")} />

      <div className="shrink-0" style={{ width: chatW }}>
        <ChatPanel
          sources={sources}
          selected={selected}
          onSelectionReset={() => setSelected(new Set())}
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

