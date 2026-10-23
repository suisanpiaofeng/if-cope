"use client";

/**
 * 解题答疑 · 知识地图（一级功能页）
 * 多地图标签并存；问答成卡片、追问成连线（关系标签）；卡片可调大小；
 * 资源可拖进对话框作依据；引用在右侧预览；地图自动保存可重开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  type Connection,
  type Edge,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Sidebar from "@/components/Sidebar";
import QAMapCard, { type QaMapRFNode } from "@/components/qa-map/QAMapCard";
import EdgesOverlay from "@/components/qa-map/EdgesOverlay";
import SourcePreviewDrawer from "@/components/qa-map/SourcePreviewDrawer";
import { DND_MIME, readDnd } from "@/lib/dnd";
import {
  nextNodePosition,
  normalizeQaMap,
  qaMapToMarkdown,
  type QaMapData,
  type QaMapNode,
} from "@/lib/qaMapTypes";
import type { Source } from "@/lib/types";

const nodeTypes = { qaCard: QAMapCard };

type MapTab = {
  key: string;
  mapId: number | null;
  title: string;
  nodes: QaMapNode[];
  selectedId: string | null;
};

type HistoryItem = { id: number; title: string; created_at: number };

let tabSeq = 1;
const newTab = (): MapTab => ({
  key: `m${Date.now().toString(36)}${tabSeq++}`,
  mapId: null,
  title: "未命名知识地图",
  nodes: [],
  selectedId: null,
});

export default function SolvePage() {
  const [tabs, setTabs] = useState<MapTab[]>([newTab()]);
  const [activeKey, setActiveKey] = useState<string>(() => "");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saveState, setSaveState] = useState("已保存");
  const [sources, setSources] = useState<Source[]>([]);
  const [contextIds, setContextIds] = useState<Set<number>>(new Set());
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<{ nodeId: string; relation: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveKey((k) => k || tabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const loadHistory = useCallback(() => {
    fetch("/api/artifacts?categoryId=all")
      .then((r) => r.json())
      .then((d) => setHistory((d.artifacts ?? []).filter((a: { type: string }) => a.type === "qa-map")));
  }, []);

  useEffect(() => {
    loadHistory();
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []));
  }, [loadHistory]);

  const patchActive = useCallback(
    (partial: Partial<MapTab>, markDirty = true) => {
      setTabs((prev) => {
        const key = activeKey || prev[0].key;
        const next = prev.map((t) => (t.key === key ? { ...t, ...partial } : t));
        if (markDirty && key) {
          const t = next.find((x) => x.key === key);
          if (t && t.mapId != null) {
            setSaveState("保存中…");
            const data: QaMapData = { title: t.title, nodes: t.nodes };
            fetch(`/api/artifacts/${t.mapId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: JSON.stringify(data), title: t.title }),
            })
              .then(() => setSaveState("已保存"))
              .catch(() => setSaveState("保存失败"));
          }
        }
        return next;
      });
    },
    [activeKey]
  );

  // ── 提问 / 追问 ──
  async function ask(question: string, explicitParentId?: string) {
    if (!active || busyKey) return;
    setBusyKey(active.key);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          mapId: active.mapId,
          ...(explicitParentId ? { parentId: explicitParentId } : {}),
          ...(contextIds.size ? { sourceIds: [...contextIds] } : {}),
          image: image?.dataUrl ?? null,
        }),
      });
      const d = (await res.json()) as {
        error?: string;
        mapId?: number;
        node?: QaMapNode;
        model?: string;
        autoRouted?: boolean;
      };
      if (!res.ok || !d.node) throw new Error(d.error || "解答失败");
      setTabs((prev) =>
        prev.map((t) =>
          t.key === active.key
            ? {
                ...t,
                mapId: d.mapId ?? t.mapId,
                nodes: [...t.nodes, d.node!],
                selectedId: d.node!.id,
                title: t.mapId == null && d.mapId != null ? d.node!.title : t.title,
              }
            : t
        )
      );
      setImage(null);
      setInput("");
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  // ── 卡片操作 ──
  const onFollowUp = useCallback((parentId: string, question: string) => void ask(question, parentId), [ask, active, contextIds, image]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCite = useCallback(
    (sourceId: number) => {
      const s = sources.find((x) => x.id === sourceId);
      if (s) setPreviewSource(s);
    },
    [sources]
  );

  const onResize = useCallback(
    (id: string, w: number, h: number) => {
      // 拖动过程中只改本地状态不落库，拖完 onResizeEnd 统一保存
      patchActive({ nodes: active.nodes.map((n) => (n.id === id ? { ...n, w, h } : n)) }, false);
    },
    [active, patchActive]
  );

  const onResizeEnd = useCallback(() => {
    patchActive({});
  }, [patchActive]);

  const onDelete = useCallback(
    (node: QaMapNode) => {
      const next = active.nodes
        .filter((n) => n.id !== node.id)
        .map((n) => (n.parentId === node.id ? { ...n, parentId: node.parentId } : n));
      patchActive({ nodes: next, selectedId: null });
    },
    [active, patchActive]
  );

  // ── 受控节点：全量应用变化（position + dimensions 测量值，缺一不可）。
  //    只应用 position 会让 RF 算不出节点尺寸 → 连线不渲染（历史 bug）；
  //    不接 onNodesChange 则拖动状态冲突卡片消失（更早的 bug） ──
  const onNodesChange = useCallback(
    (changes: NodeChange<QaMapRFNode>[]) => {
      setTabs((prev) =>
        prev.map((t) => {
          const key = activeKey || prev[0].key;
          if (t.key !== key) return t;
          const posById = new Map<string, { x: number; y: number }>();
          const dimById = new Map<string, { width?: number; height?: number }>();
          for (const c of changes) {
            if (c.type === "position" && c.position) posById.set(c.id, c.position);
            else if (c.type === "dimensions" && c.dimensions) dimById.set(c.id, c.dimensions);
          }
          const next = t.nodes.map((n) => {
            const pos = posById.get(n.id);
            const dim = dimById.get(n.id);
            return {
              ...n,
              x: pos?.x ?? n.x,
              y: pos?.y ?? n.y,
              w: dim?.width || n.w,
              h: dim?.height || n.h,
            };
          });
          return { ...t, nodes: next };
        })
      );
    },
    [activeKey]
  );

  // ── 自定义连线：拖右侧锚点到另一张卡 → 建立父子关系（防环） ──
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const isAncestor = (maybeAncestor: string, nodeId: string): boolean => {
        let cur = active.nodes.find((n) => n.id === nodeId);
        while (cur?.parentId) {
          if (cur.parentId === maybeAncestor) return true;
          cur = active.nodes.find((n) => n.id === cur!.parentId);
        }
        return false;
      };
      if (isAncestor(conn.target, conn.source)) {
        setError("不能连回自己的上游（会成环）");
        return;
      }
      patchActive({
        nodes: active.nodes.map((n) =>
          n.id === conn.target ? { ...n, parentId: conn.source, relation: n.relation ?? "追问" } : n
        ),
      });
    },
    [active, patchActive]
  );

  // ── 点边：改关系词 / 断开 ──
  const applyEdgeRelation = useCallback(() => {
    if (!selectedEdge) return;
    patchActive({
      nodes: active.nodes.map((n) =>
        n.id === selectedEdge.nodeId ? { ...n, relation: selectedEdge.relation.trim().slice(0, 10) || "追问" } : n
      ),
    });
    setSelectedEdge(null);
  }, [active, patchActive, selectedEdge]);

  const disconnectEdge = useCallback(() => {
    if (!selectedEdge) return;
    patchActive({
      nodes: active.nodes.map((n) => (n.id === selectedEdge.nodeId ? { ...n, parentId: null, relation: undefined } : n)),
    });
    setSelectedEdge(null);
  }, [active, patchActive, selectedEdge]);

  const onNodeDragStop: OnNodeDrag<QaMapRFNode> = useCallback(
    (_e, rfNode) => {
      patchActive({
        nodes: active.nodes.map((n) =>
          n.id === rfNode.id ? { ...n, x: rfNode.position.x, y: rfNode.position.y } : n
        ),
      });
    },
    [active, patchActive]
  );

  // ── 地图标签 ──
  function openHistory(id: number) {
    const existing = tabs.find((t) => t.mapId === id);
    if (existing) {
      setActiveKey(existing.key);
      return;
    }
    fetch(`/api/artifacts/${id}`)
      .then((r) => r.json())
      .then((d) => {
        try {
          const map = JSON.parse(d.content ?? "") as QaMapData;
          const t: MapTab = {
            key: `m${Date.now().toString(36)}${tabSeq++}`,
            mapId: id,
            title: map.title || d.title || "知识地图",
            nodes: map.nodes ?? [],
            selectedId: null,
          };
          setTabs((prev) => [...prev, t]);
          setActiveKey(t.key);
          setNotice(`已打开《${t.title}》`);
        } catch {
          setError("地图数据损坏");
        }
      });
  }

  function addTab() {
    const t = newTab();
    setTabs((prev) => [...prev, t]);
    setActiveKey(t.key);
  }

  /** 导入知识地图（导出的 JSON）：校验 → 存为产物 → 新标签打开续写 */
  async function importMap(f: File | undefined) {
    if (!f) return;
    setError("");
    try {
      const raw: unknown = JSON.parse(await f.text());
      const map = normalizeQaMap(raw);
      if (!map) throw new Error("不是有效的知识地图 JSON（需含 nodes 卡片数组）");
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: map.title, content: JSON.stringify(map), kind: "qa-map", sourceIds: [] }),
      });
      const d = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || d.id == null) throw new Error(d.error || "导入失败");
      const t: MapTab = {
        key: `m${Date.now().toString(36)}${tabSeq++}`,
        mapId: d.id,
        title: map.title,
        nodes: map.nodes,
        selectedId: null,
      };
      setTabs((prev) => [...prev, t]);
      setActiveKey(t.key);
      setNotice(`已导入《${map.title}》（${map.nodes.length} 张卡片），可继续追问续写`);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  function closeTab(key: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      const list = next.length ? next : [newTab()];
      if (key === activeKey) setActiveKey(list[list.length - 1].key);
      return list;
    });
  }

  function download(kind: "md" | "json") {
    if (!active) return;
    const data: QaMapData = { title: active.title, nodes: active.nodes };
    const body = kind === "md" ? qaMapToMarkdown(data) : JSON.stringify(data, null, 2);
    const blob = new Blob([body], {
      type: kind === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(active.title || "知识地图").replace(/[\\/:*?"<>|]/g, "_")}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── React Flow 数据 ──
  const rfNodes = useMemo<QaMapRFNode[]>(
    () =>
      (active?.nodes ?? []).map((n) => ({
        id: n.id,
        type: "qaCard",
        position: { x: n.x, y: n.y },
        selected: n.id === active?.selectedId,
        data: {
          node: n,
          onFollowUp,
          onCite,
          onDelete,
          onResize,
          onResizeEnd,
          busy: busyKey === active?.key,
        },
      })),
    [active, busyKey, onFollowUp, onCite, onDelete, onResize, onResizeEnd]
  );

  const ready = sources.filter((s) => s.status === "ready");
  const attachNode = active?.selectedId ? active.nodes.find((n) => n.id === active.selectedId) : null;

  // ── 切换/打开地图后视口自动适配（否则卡片可能在屏幕外，看起来像“不显示”） ──
  const rfInstanceRef = useRef<ReactFlowInstance<QaMapRFNode, Edge> | null>(null);
  useEffect(() => {
    const t = setTimeout(() => rfInstanceRef.current?.fitView({ duration: 350, padding: 0.15 }), 80);
    return () => clearTimeout(t);
  }, [activeKey, active?.mapId, active?.nodes.length]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 左栏：地图管理 + 资源框 */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">解题答疑</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">问答成卡片 · 追问成地图 · 沉淀知识库</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {error && (
            <div className="mb-2 border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>
          )}
          {notice && (
            <div className="mb-2 border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">{notice}</div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              我的知识地图 <span className="num">{history.length}</span>
            </span>
            <div className="flex gap-1">
              <button onClick={() => importRef.current?.click()} className="text-[11px] text-neutral-400 hover:text-neutral-900">导入</button>
              <button onClick={addTab} className="text-[11px] text-neutral-400 hover:text-neutral-900">＋ 新地图</button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => void importMap(e.target.files?.[0])}
            />
          </div>
          <div className="mt-1 space-y-0.5">
            {history.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-neutral-300">暂无，问第一个问题就会自动保存</p>
            ) : (
              history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => openHistory(h.id)}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-[11px] hover:bg-neutral-50 ${
                    active?.mapId === h.id ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-600"
                  }`}
                  title={h.title}
                >
                  🗺 {h.title}
                </button>
              ))
            )}
          </div>

          {/* 资源框：勾选或拖进对话框作依据 */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                资源 <span className="num">{contextIds.size > 0 ? `依据 ${contextIds.size}` : "全部"}</span>
              </span>
              <button onClick={() => setContextIds(new Set())} className="text-[11px] text-neutral-400 hover:text-neutral-900">
                清空
              </button>
            </div>
            <div className="mt-1 max-h-[240px] overflow-y-auto border border-neutral-100">
              {ready.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-neutral-300">暂无资料（可先去工作台上传）</p>
              ) : (
                ready.map((s) => (
                  <div
                    key={s.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: "source", ids: [s.id] }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className={`flex cursor-grab items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-neutral-50 ${
                      contextIds.has(s.id) ? "bg-neutral-100" : ""
                    }`}
                    title="拖进对话框作为依据，或点击勾选"
                  >
                    <input
                      type="checkbox"
                      checked={contextIds.has(s.id)}
                      onChange={() =>
                        setContextIds((prev) => {
                          const n = new Set(prev);
                          if (n.has(s.id)) n.delete(s.id);
                          else n.add(s.id);
                          return n;
                        })
                      }
                      className="accent-neutral-900"
                    />
                    <span className="truncate text-neutral-700">{s.title}</span>
                  </div>
                ))
              )}
            </div>
            <p className="mt-1 text-[10px] text-neutral-400">拖到下方对话框 = 指定依据；不指定 = 自动检索全部</p>
          </div>
        </div>
      </div>

      {/* 主区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 地图标签栏 */}
        <div className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-50/60 px-2 pt-1.5">
          {tabs.map((t) => (
            <div
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className={`group flex max-w-[180px] cursor-pointer items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 text-[11px] ${
                t.key === activeKey
                  ? "border-neutral-200 bg-white font-medium text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              <span className="truncate">{t.title || "未命名知识地图"}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.key);
                }}
                className="shrink-0 text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
          <button onClick={addTab} title="新地图" className="px-2 py-1.5 text-[12px] text-neutral-400 hover:text-neutral-900">
            ＋
          </button>
        </div>

        {/* 工具条 */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2">
          <input
            value={active?.title ?? ""}
            onChange={(e) => patchActive({ title: e.target.value }, false)}
            onBlur={() => patchActive({})}
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
            工作台
          </Link>
        </div>

        {/* 画布 + 右侧预览 */}
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {(active?.nodes.length ?? 0) === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-[420px] text-center">
                  <div className="text-4xl">🗺</div>
                  <p className="mt-3 text-sm text-neutral-400">
                    在下方对话框输入第一个问题，生成第一张卡片；
                    <br />
                    之后的问题会自动判断是「追问某张卡」还是「新话题」，连成你的知识地图
                  </p>
                </div>
              </div>
            ) : (
              <ReactFlow
                nodes={rfNodes}
                nodeTypes={nodeTypes}
                onInit={(i) => (rfInstanceRef.current = i)}
                onNodesChange={onNodesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={(_e, n) => patchActive({ selectedId: n.id }, false)}
                onPaneClick={() => {
                  patchActive({ selectedId: null }, false);
                  setSelectedEdge(null);
                }}
                fitView
                minZoom={0.1}
                nodesDraggable
                nodesConnectable
              >
                <Background gap={20} size={1} color="#ececec" />
                <Controls showInteractive={false} />
                {/* 连线层：自绘 SVG（RF 边管道不可靠，自绘稳定且可交互） */}
                <EdgesOverlay
                  nodes={active?.nodes ?? []}
                  selectedEdgeId={selectedEdge?.nodeId}
                  onEdgeClick={(childId) => {
                    const child = active.nodes.find((n) => n.id === childId);
                    if (child) setSelectedEdge({ nodeId: child.id, relation: child.relation ?? "追问" });
                  }}
                />
              </ReactFlow>
            )}

            {/* 边编辑：改关系词 / 断开连线 */}
            {selectedEdge && (
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-lg">
                <span className="text-[11px] text-neutral-500">连线关系</span>
                <input
                  value={selectedEdge.relation}
                  onChange={(e) => setSelectedEdge({ ...selectedEdge, relation: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && applyEdgeRelation()}
                  className="w-24 rounded border border-neutral-200 px-2 py-1 text-[11px] outline-none focus:border-neutral-400"
                  placeholder="如：追问 / 延伸 / 对比"
                />
                <button onClick={applyEdgeRelation} className="rounded border border-neutral-900 bg-neutral-900 px-2 py-1 text-[10px] text-white hover:bg-neutral-700">
                  应用
                </button>
                <button onClick={disconnectEdge} className="rounded border border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 hover:border-red-300 hover:text-red-600">
                  断开
                </button>
                <button onClick={() => setSelectedEdge(null)} className="px-1 text-[11px] text-neutral-300 hover:text-neutral-700">×</button>
              </div>
            )}

            {/* 底部对话框（悬浮，可拖入资源） */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
              <div
                className={`pointer-events-auto w-[640px] rounded-lg border bg-white shadow-lg transition-colors ${
                  dropOver ? "border-violet-500 ring-1 ring-violet-300" : "border-neutral-300"
                }`}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(DND_MIME)) {
                    e.preventDefault();
                    setDropOver(true);
                  }
                }}
                onDragLeave={() => setDropOver(false)}
                onDrop={(e) => {
                  const p = readDnd(e.dataTransfer);
                  setDropOver(false);
                  if (p && p.kind === "source") {
                    setContextIds((prev) => new Set([...prev, ...p.ids]));
                  }
                }}
              >
                {contextIds.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-3 py-1.5">
                    {[...contextIds].map((id) => (
                      <span key={id} className="flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">
                        <span className="max-w-[120px] truncate">{sources.find((s) => s.id === id)?.title ?? id}</span>
                        <button
                          onClick={() =>
                            setContextIds((prev) => {
                              const n = new Set(prev);
                              n.delete(id);
                              return n;
                            })
                          }
                          className="text-violet-400 hover:text-violet-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-start gap-2 p-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    title="附题目照片"
                    className="mt-1 shrink-0 rounded border border-neutral-200 px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
                  >
                    📷
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const r = new FileReader();
                      r.onload = () => setImage({ dataUrl: String(r.result), name: f.name });
                      r.readAsDataURL(f);
                    }}
                  />
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (input.trim()) void ask(input.trim());
                      }
                    }}
                    rows={2}
                    placeholder={
                      attachNode
                        ? `输入问题，Enter 发送（选中「${attachNode.title}」，不相关会自动开新话题）…`
                        : "输入问题，Enter 发送（追问/新话题自动判断）…"
                    }
                    className="min-w-0 flex-1 resize-none rounded border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
                  />
                  <button
                    onClick={() => input.trim() && void ask(input.trim())}
                    disabled={!!busyKey || !input.trim()}
                    className="mt-1 shrink-0 rounded border border-neutral-900 bg-neutral-900 px-3.5 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
                  >
                    {busyKey ? "…" : "发送"}
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

          {/* 右侧预览抽屉 */}
          <SourcePreviewDrawer source={previewSource} onClose={() => setPreviewSource(null)} />
        </div>
      </main>
    </div>
  );
}
