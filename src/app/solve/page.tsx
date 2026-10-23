"use client";

/**
 * 解题答疑 · 知识地图（一级功能页）
 * 每次问答 = 一张卡片；追问从卡片长出新卡并连线，形成个人知识地图。
 * 卡片可拖动、可从任意节点追问、可归档进知识库；地图自动保存、可重开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type OnNodeDrag,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Sidebar from "@/components/Sidebar";
import QAMapCard, { type QaMapRFNode } from "@/components/qa-map/QAMapCard";
import {
  nextNodePosition,
  qaCardToMarkdown,
  qaMapToMarkdown,
  type QaMapData,
  type QaMapNode,
} from "@/lib/qaMapTypes";

const nodeTypes = { qaCard: QAMapCard };

type HistoryItem = { id: number; title: string; created_at: number };

export default function SolvePage() {
  const [mapId, setMapId] = useState<number | null>(null);
  const [title, setTitle] = useState("未命名知识地图");
  const [nodes, setNodes] = useState<QaMapNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saveState, setSaveState] = useState("已保存");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);

  const loadHistory = useCallback(() => {
    fetch("/api/artifacts?categoryId=all")
      .then((r) => r.json())
      .then((d) => setHistory((d.artifacts ?? []).filter((a: { type: string }) => a.type === "qa-map")));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── 自动保存（拖动/改名/删卡后落库；提问时服务端已存） ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useCallback(
    (data: QaMapData, id: number) => {
      setSaveState("保存中…");
      fetch(`/api/artifacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(data), title: data.title }),
      })
        .then(() => setSaveState("已保存"))
        .catch(() => setSaveState("保存失败"));
    },
    []
  );
  const scheduleSave = useCallback(
    (data: QaMapData) => {
      if (mapId == null) return;
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        dirtyRef.current = false;
        saveNow(data, mapId);
      }, 1200);
    },
    [mapId, saveNow]
  );
  useEffect(() => {
    if (dirtyRef.current && mapId != null) scheduleSave({ title, nodes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, nodes]);

  // ── 提问 / 追问 ──
  async function ask(question: string, parentId: string | null) {
    if (busyId) return;
    const target = parentId ?? selectedId ?? nodes[nodes.length - 1]?.id ?? null;
    setBusyId(target ?? "__root__");
    setError("");
    setNotice("");
    try {
      const pos = nextNodePosition(nodes, target);
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          mapId,
          parentId: target,
          x: pos.x,
          y: pos.y,
          image: image?.dataUrl ?? null,
        }),
      });
      const d = (await res.json()) as { error?: string; mapId?: number; node?: QaMapNode; model?: string };
      if (!res.ok || !d.node) throw new Error(d.error || "解答失败");
      setNodes((prev) => [...prev, d.node!]);
      setMapId(d.mapId ?? mapId);
      setSelectedId(d.node.id);
      setImage(null);
      setInput("");
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  // ── 卡片操作 ──
  const onFollowUp = useCallback((parentId: string, question: string) => void ask(question, parentId), [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCite = useCallback((sourceId: number) => {
    if (sourceId >= 0) window.open(`/?openSource=${sourceId}`, "_blank");
  }, []);

  const onArchive = useCallback((node: QaMapNode) => {
    fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: node.title, content: qaCardToMarkdown(node), type: "note", sourceIds: [] }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setNotice(`《${node.title}》已归档进知识库（AIGC）`);
      });
  }, []);

  const onDelete = useCallback(
    (node: QaMapNode) => {
      setNodes((prev) => {
        const next = prev
          .filter((n) => n.id !== node.id)
          .map((n) => (n.parentId === node.id ? { ...n, parentId: node.parentId } : n));
        scheduleSave({ title, nodes: next });
        return next;
      });
      setSelectedId(null);
    },
    [scheduleSave, title]
  );

  // ── 拖动落库 ──
  const onNodeDragStop: OnNodeDrag<QaMapRFNode> = useCallback(
    (_e, rfNode: RFNode) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.id === rfNode.id ? { ...n, x: rfNode.position.x, y: rfNode.position.y } : n
        );
        scheduleSave({ title, nodes: next });
        return next;
      });
    },
    [scheduleSave, title]
  );

  // ── 历史地图 ──
  async function openHistory(id: number) {
    const res = await fetch(`/api/artifacts/${id}`);
    if (!res.ok) return;
    const d = (await res.json()) as { content?: string; title?: string };
    try {
      const map = JSON.parse(d.content ?? "") as QaMapData;
      setMapId(id);
      setTitle(map.title || d.title || "知识地图");
      setNodes(map.nodes ?? []);
      setSelectedId(null);
      setError("");
      setNotice(`已打开知识地图《${map.title || d.title}》`);
    } catch {
      setError("地图数据损坏");
    }
  }

  function newMap() {
    setMapId(null);
    setTitle("未命名知识地图");
    setNodes([]);
    setSelectedId(null);
    setError("");
    setNotice("已新建地图，输入第一个问题开始");
  }

  function download(kind: "md" | "json") {
    const data: QaMapData = { title, nodes };
    const body = kind === "md" ? qaMapToMarkdown(data) : JSON.stringify(data, null, 2);
    const blob = new Blob([body], {
      type: kind === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || "知识地图").replace(/[\\/:*?"<>|]/g, "_")}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── React Flow 数据 ──
  const rfNodes = useMemo<QaMapRFNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "qaCard",
        position: { x: n.x, y: n.y },
        selected: n.id === selectedId,
        data: {
          node: n,
          onFollowUp,
          onCite,
          onArchive,
          onDelete,
          busy: busyId === n.id,
        },
      })),
    [nodes, selectedId, busyId, onFollowUp, onCite, onArchive, onDelete]
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      nodes
        .filter((n) => n.parentId)
        .map((n) => ({
          id: `${n.parentId}-${n.id}`,
          source: n.parentId!,
          target: n.id,
          type: "smoothstep",
        })),
    [nodes]
  );

  const attachTo = selectedId ?? nodes[nodes.length - 1]?.id ?? null;
  const attachNode = attachTo ? nodes.find((n) => n.id === attachTo) : null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 左栏：地图管理 */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">解题答疑</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">问答成卡片 · 追问成地图 · 沉淀成知识库</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <button
            onClick={newMap}
            className="w-full border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
          >
            ＋ 新地图
          </button>

          {error && (
            <div className="mt-3 border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>
          )}
          {notice && (
            <div className="mt-3 border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
              {notice}
            </div>
          )}

          <div className="mt-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              我的知识地图 <span className="num">{history.length}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {history.length === 0 ? (
                <p className="px-1 py-1 text-[11px] text-neutral-300">暂无，问第一个问题就会自动保存</p>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => void openHistory(h.id)}
                    className={`block w-full truncate rounded px-2 py-1.5 text-left text-[11px] hover:bg-neutral-50 ${
                      h.id === mapId ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-600"
                    }`}
                    title={h.title}
                  >
                    🗺 {h.title}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-5 border-t border-neutral-100 pt-3 text-[10px] leading-5 text-neutral-400">
            · 卡片可随意拖动
            <br />· 选中卡片后可在其下方追问
            <br />· 📎 引用可跳转资料原文
            <br />· 归档的卡片进知识库（AIGC）
          </div>
        </div>
      </div>

      {/* 主区：地图画布 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 truncate rounded border border-transparent px-2 py-1 text-[14px] font-semibold outline-none hover:border-neutral-200 focus:border-neutral-400"
            placeholder="地图标题"
          />
          <span className="num shrink-0 text-[10px] text-neutral-400">{saveState}</span>
          <button onClick={() => download("md")} className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
            导出 MD
          </button>
          <button onClick={() => download("json")} className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
            导出 JSON
          </button>
          <Link href="/" className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
            去工作台
          </Link>
        </div>

        <div className="relative min-h-0 flex-1">
          {nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-[420px] text-center">
                <div className="text-4xl">🗺</div>
                <p className="mt-3 text-sm text-neutral-400">
                  在下方对话框输入第一个问题，生成第一张卡片；
                  <br />
                  之后每次提问/追问都会连成你的知识地图
                </p>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={(_e, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              minZoom={0.12}
              nodesDraggable
              nodesConnectable={false}
              edgesFocusable={false}
            >
              <Background gap={20} size={1} color="#ececec" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}

          {/* 底部对话框（悬浮） */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
            <div className="pointer-events-auto w-[620px] rounded-lg border border-neutral-300 bg-white shadow-lg">
              <div className="flex items-start gap-2 p-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  title="附题目照片"
                  className="mt-1 shrink-0 rounded border border-neutral-200 px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
                >
                  📷
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setImage({ dataUrl: String(r.result), name: f.name });
                  r.readAsDataURL(f);
                }} />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) void ask(input.trim(), null);
                    }
                  }}
                  rows={2}
                  placeholder={
                    attachNode
                      ? `输入问题，Enter 发送（将从「${attachNode.title}」继续）…`
                      : "输入问题开始，Enter 发送…"
                  }
                  className="min-w-0 flex-1 resize-none rounded border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
                />
                <button
                  onClick={() => input.trim() && void ask(input.trim(), null)}
                  disabled={!!busyId || !input.trim()}
                  className="mt-1 shrink-0 rounded border border-neutral-900 bg-neutral-900 px-3.5 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  {busyId ? "…" : "发送"}
                </button>
              </div>
              {image && (
                <div className="flex items-center gap-1.5 border-t border-neutral-100 px-3 py-1 text-[11px] text-neutral-500">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.dataUrl} alt="" className="h-5 w-5 object-cover" />
                  <span className="truncate">{image.name}</span>
                  <button onClick={() => setImage(null)} className="text-neutral-400 hover:text-red-600">×</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
