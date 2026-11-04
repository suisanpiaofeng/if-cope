"use client";

/**
 * 共享资源库状态（第二栏数据层单点实现）：
 * 工作台/文献翻译/解题答疑三页共用同一份「取数 + 勾选 + 上传/链接/文本入库 + 删/建/移类目」逻辑，
 * 各页只做视图过滤（sourceFilter/artifactFilter：翻译页只列 PDF、解题页只列 ready）。
 * 页面特有区块（翻译历史、知识地图管理）通过 FilesPanel 的插槽挂载，不进这里。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Source } from "./types";
import type { Artifact } from "@/components/FilesPanel";

export type Category = { id: number; name: string; parent_id: number | null; pinned: number };

export function useLibrary(opts?: {
  /** 视图过滤：只把这些资源计入「可见集合」（全选/类目勾选/计数都按它算） */
  sourceFilter?: (s: Source) => boolean;
  artifactFilter?: (a: Artifact) => boolean;
  /** 删除回调（工作台用来关掉对应预览标签） */
  onSourceRemoved?: (id: number) => void;
  onArtifactRemoved?: (id: number) => void;
  /** false = 不自动取数（特殊页面自己控制时机）；默认 true */
  autoLoad?: boolean;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  // 勾选（对话/翻译/问答依据上下文；资源与产物分开存防 id 撞车）
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedArts, setSelectedArts] = useState<Set<number>>(new Set());
  const [genError, setGenError] = useState<string | null>(null);

  // 过滤器走 ref：页面每次渲染都是新函数，直接当依赖会反复触发 effect
  const srcFilterRef = useRef(opts?.sourceFilter);
  srcFilterRef.current = opts?.sourceFilter;
  const artFilterRef = useRef(opts?.artifactFilter);
  artFilterRef.current = opts?.artifactFilter;
  const onSrcRemovedRef = useRef(opts?.onSourceRemoved);
  onSrcRemovedRef.current = opts?.onSourceRemoved;
  const onArtRemovedRef = useRef(opts?.onArtifactRemoved);
  onArtRemovedRef.current = opts?.onArtifactRemoved;

  const load = useCallback(async () => {
    const [srcRes, artRes] = await Promise.all([
      fetch("/api/sources"),
      fetch("/api/artifacts?categoryId=all"),
    ]);
    const data = await srcRes.json();
    setSources(data.sources ?? []);
    setCategories(data.categories ?? []);
    setArtifacts((await artRes.json()).artifacts ?? []);
  }, []);

  useEffect(() => {
    if (opts?.autoLoad !== false) void load();
  }, [load, opts?.autoLoad]);

  // ── 勾选 ──
  function toggleSelect(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectArtifact(id: number) {
    setSelectedArts((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  /** 追加/移除勾选（解题页拖拽入框等） */
  function addSelection(ids: number[]) {
    setSelected((prev) => new Set([...prev, ...ids]));
  }
  function removeSelection(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
  /** 只选中指定集合（翻译页「选英文文献」） */
  function selectOnly(ids: number[]) {
    setSelected(new Set(ids));
  }
  function clearSelection() {
    setSelected(new Set());
    setSelectedArts(new Set());
  }
  /** 类目勾选：文件夹内可见资源+产物全选/全不选（可见 = 过滤后） */
  function toggleFolderSelect(folderId: number | "ungrouped") {
    const inFolder = <T extends { category_id: number | null }>(rows: T[]) =>
      rows.filter((r) => (folderId === "ungrouped" ? r.category_id == null : r.category_id === folderId));
    const srcIds = inFolder(sources).filter((s) => srcFilterRef.current?.(s) ?? true).map((s) => s.id);
    const artIds = inFolder(artifacts).filter((a) => artFilterRef.current?.(a) ?? true).map((a) => a.id);
    const flip = (prev: Set<number>, ids: number[]) => {
      const n = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => n.has(id));
      ids.forEach((id) => (allOn ? n.delete(id) : n.add(id)));
      return n;
    };
    setSelected((prev) => flip(prev, srcIds));
    setSelectedArts((prev) => flip(prev, artIds));
  }
  /** 全选：只选可见集合（翻译页=全部 PDF，解题页=全部 ready） */
  function toggleSelectAll() {
    const visSrc = sources.filter((s) => srcFilterRef.current?.(s) ?? true);
    const visArt = artifacts.filter((a) => artFilterRef.current?.(a) ?? true);
    const allOn = visSrc.length > 0 && visSrc.every((s) => selected.has(s.id))
      && visArt.every((a) => selectedArts.has(a.id));
    setSelected(allOn ? new Set() : new Set(visSrc.map((s) => s.id)));
    setSelectedArts(allOn ? new Set() : new Set(visArt.map((a) => a.id)));
  }

  // ── 入库 ──
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

  // ── 删除 ──
  async function removeSource(id: number) {
    await fetch(`/api/sources/${id}`, { method: "DELETE" });
    onSrcRemovedRef.current?.(id);
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await load();
  }
  async function removeArtifact(id: number) {
    await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
    onArtRemovedRef.current?.(id);
    setSelectedArts((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await load();
  }
  async function removeCategory(id: number) {
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    await load();
  }
  async function newCategory(name: string, parentId: number | null = null) {
    await fetch("/api/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    await load();
  }

  // ── 拖拽移动（资源 / 成果 换类目） ──
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

  return {
    // 数据
    sources, artifacts, categories, genError, setGenError, load,
    // 勾选
    selected, selectedArts, setSelected, setSelectedArts,
    toggleSelect, toggleSelectArtifact, toggleFolderSelect, toggleSelectAll,
    addSelection, removeSelection, selectOnly, clearSelection,
    // 操作
    upload, addLink, addText,
    removeSource, removeArtifact, removeCategory, newCategory,
    moveSource, moveArtifact,
  };
}
