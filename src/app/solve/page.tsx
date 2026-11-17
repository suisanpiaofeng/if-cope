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
import FilesPanel from "@/components/FilesPanel";
import ChatPanel from "@/components/ChatPanel";
import QAMapCard, { type QaMapRFNode } from "@/components/qa-map/QAMapCard";
import EdgesOverlay from "@/components/qa-map/EdgesOverlay";
import EdgeDialog from "@/components/qa-map/EdgeDialog";
import RepairDialog, { type RepairSuggestion } from "@/components/qa-map/RepairDialog";
import AnalyzeDialog from "@/components/qa-map/AnalyzeDialog";
import SourcePreviewDrawer from "@/components/qa-map/SourcePreviewDrawer";
import {
  autoLayout,
  edgeId,
  hasCycle,
  nextNodePosition,
  normalizeQaMap,
  qaMapToMarkdown,
  type QaMapData,
  type QaMapEdge,
  type QaMapNode,
} from "@/lib/qaMapTypes";
import type { Source } from "@/lib/types";
import { useLibrary } from "@/lib/useLibrary";

const nodeTypes = { qaCard: QAMapCard };

type MapTab = {
  key: string;
  mapId: number | null;
  title: string;
  nodes: QaMapNode[];
  edges: QaMapEdge[];
  selectedId: string | null;
  /** 检索范围：多选项目 id（空=全部）；地图全局无归属（P4 定稿 §〇） */
  projectScope?: number[];
};

let tabSeq = 1;
const newTab = (): MapTab => ({
  key: `m${Date.now().toString(36)}${tabSeq++}`,
  mapId: null,
  title: "未命名知识地图",
  nodes: [],
  edges: [],
  selectedId: null,
  projectScope: [],
});

export default function SolvePage() {
  const [tabs, setTabs] = useState<MapTab[]>([newTab()]);
  const [activeKey, setActiveKey] = useState<string>(() => "");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 检索范围多选（P4 定稿）：地图全局无归属，多选项目仅圈定答题检索
  const [scopeOpen, setScopeOpen] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: number; title: string }>>([]);
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: { projects?: Array<{ id: number; title: string }> }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  function toggleScope(id: number) {
    if (!active) return;
    const cur = active.projectScope ?? [];
    patchActive({ projectScope: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }
  const [saveState, setSaveState] = useState("已保存");
  // 共享资源库：视图过滤 = 仅 ready；勾选集即问答依据（可拖入下方对话框）
  const lib = useLibrary({ sourceFilter: (s) => s.status === "ready" });
  const { sources, categories, selected: contextIds } = lib;
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    edgeId: string;
    end: "from" | "to";
    draft: string;
  } | null>(null);
  // 待确认的手动连线（弹窗填两端标注后才建边）
  const [pendingConn, setPendingConn] = useState<{ from: string; to: string } | null>(null);
  // 删卡智能修复（B）：中间卡删除时的接续建议
  const [repair, setRepair] = useState<{
    node: QaMapNode;
    upstream: QaMapNode[];
    downstream: QaMapNode[];
    suggestions: RepairSuggestion | null;
  } | null>(null);
  // AI 地图体检（A）
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  // ── 撤销/重做（E）：每次有意义变更前快照 {nodes, edges}，Ctrl+Z/Y 或按钮回溯 ──
  type Snap = { nodes: QaMapNode[]; edges: QaMapEdge[] };
  const historyRef = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const [histVer, setHistVer] = useState(0); // 驱动撤销/重做按钮可用态刷新

  const pushHistory = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    const h = historyRef.current;
    h.past.push({ nodes: a.nodes, edges: a.edges ?? [] });
    if (h.past.length > 50) h.past.shift();
    h.future = [];
    setHistVer((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const a = activeRef.current;
    const h = historyRef.current;
    if (!a || h.past.length === 0) return;
    h.future.push({ nodes: a.nodes, edges: a.edges ?? [] });
    const snap = h.past.pop()!;
    patchActiveRef.current({ nodes: snap.nodes, edges: snap.edges });
    setHistVer((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const a = activeRef.current;
    const h = historyRef.current;
    if (!a || h.future.length === 0) return;
    h.past.push({ nodes: a.nodes, edges: a.edges ?? [] });
    const snap = h.future.pop()!;
    patchActiveRef.current({ nodes: snap.nodes, edges: snap.edges });
    setHistVer((v) => v + 1);
  }, []);

  // 快捷键：Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // 一键整理布局（G）：分层排列，可撤销
  const applyAutoLayout = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    pushHistory();
    patchActiveRef.current({ nodes: autoLayout(a.nodes, a.edges ?? []) });
    setNotice("已按连线关系整理布局（Ctrl+Z 可撤销）");
  }, [pushHistory]);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveKey((k) => k || tabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  /** 知识地图历史 = 产物里 type=qa-map（共享 hook 已拉全量产物，无需另拉） */
  const history = useMemo(
    () => lib.artifacts.filter((a) => a.type === "qa-map").map((a) => ({ id: a.id, title: a.title, created_at: a.created_at })),
    [lib.artifacts]
  );
  /** 新地图/追问后刷新（连带资源列表一起刷，单点取数） */
  const loadHistory = useCallback(() => { void lib.load(); }, [lib.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchActive = useCallback(
    (partial: Partial<MapTab>, markDirty = true) => {
      setTabs((prev) => {
        const key = activeKey || prev[0].key;
        const next = prev.map((t) => (t.key === key ? { ...t, ...partial } : t));
        if (markDirty && key) {
          const t = next.find((x) => x.key === key);
          if (t && t.mapId != null) {
            setSaveState("保存中…");
            const data: QaMapData = { title: t.title, nodes: t.nodes, edges: t.edges ?? [], projectScope: t.projectScope ?? [] };
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
    // 检索范围（P4 定稿）：多选项目圈定；手选依据优先
    const scope = active.projectScope ?? [];
    const scopeIds = scope.length
      ? sources.filter((s) => s.project_id != null && scope.includes(s.project_id)).map((s) => s.id)
      : [];
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
          ...(contextIds.size ? { sourceIds: [...contextIds] } : scopeIds.length ? { sourceIds: scopeIds } : {}),
          image: image?.dataUrl ?? null,
        }),
      });
      const d = (await res.json()) as {
        error?: string;
        mapId?: number;
        node?: QaMapNode;
        links?: QaMapEdge[];
        edges?: QaMapEdge[];
        mapUpdated?: boolean;
        cardUpdated?: boolean;
        summary?: string;
        model?: string;
        autoRouted?: boolean;
      };
      if (!res.ok || (!d.node && !d.mapUpdated && !d.cardUpdated)) throw new Error(d.error || "解答失败");
      // ── 地图操作工具路径：整理连线（不生成新卡） ──
      if (d.mapUpdated) {
        setTabs((prev) =>
          prev.map((t) =>
            t.key === active.key ? { ...t, mapId: d.mapId ?? t.mapId, edges: d.edges ?? t.edges } : t
          )
        );
        setNotice(d.summary || "已整理连线");
        setImage(null);
        setInput("");
        return;
      }
      // ── 补充卡片路径：改写已有卡（不生成新卡） ──
      if (d.cardUpdated && d.node) {
        setTabs((prev) =>
          prev.map((t) =>
            t.key === active.key
              ? {
                  ...t,
                  mapId: d.mapId ?? t.mapId,
                  nodes: t.nodes.map((n) => (n.id === d.node!.id ? d.node! : n)),
                  selectedId: d.node!.id,
                }
              : t
          )
        );
        setNotice(d.summary || "已补充到卡片");
        setImage(null);
        setInput("");
        return;
      }
      // ── 正常问答：生成新卡 ──
      setTabs((prev) =>
        prev.map((t) =>
          t.key === active.key
            ? {
                ...t,
                mapId: d.mapId ?? t.mapId,
                nodes: [...t.nodes, d.node!],
                // 本次新建的边落进边表（同向去重）
                edges: [
                  ...(t.edges ?? []),
                  ...(d.links ?? []).filter(
                    (l) => !(t.edges ?? []).some((e) => e.from === l.from && e.to === l.to)
                  ),
                ],
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

  // ── 卡片操作：全部经 ref 读取最新状态 → 回调引用恒定 →
  //    卡片 data 对象不随每次拖动重造 → 消除整树重渲染（闪烁根治） ──
  const activeRef = useRef(active);
  activeRef.current = active;
  const askRef = useRef(ask);
  askRef.current = ask;
  const patchActiveRef = useRef(patchActive);
  patchActiveRef.current = patchActive;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const onFollowUp = useCallback((parentId: string, question: string) => {
    void askRef.current(question, parentId);
  }, []);

  const onCite = useCallback((sourceId: number) => {
    const s = sourcesRef.current.find((x) => x.id === sourceId);
    if (s) setPreviewSource(s);
  }, []);

  const onResize = useCallback((id: string, w: number, h: number) => {
    // 拖动过程中只改本地状态不落库，拖完 onResizeEnd 统一保存
    const a = activeRef.current;
    patchActiveRef.current({ nodes: (a?.nodes ?? []).map((n) => (n.id === id ? { ...n, w, h } : n)) }, false);
  }, []);

  const onResizeEnd = useCallback(() => {
    patchActiveRef.current({});
  }, []);

  const onDelete = useCallback((node: QaMapNode) => {
    const a = activeRef.current;
    if (!a) return;
    const edges = a.edges ?? [];
    const upstream = a.nodes.filter((n) => edges.some((e) => e.to === node.id && e.from === n.id));
    const downstream = a.nodes.filter((n) => edges.some((e) => e.from === node.id && e.to === n.id));
    // 中间卡（有进有出）：AI 建议接续连线，防知识脉络断裂（用户功能 B）
    if (upstream.length > 0 && downstream.length > 0) {
      setRepair({ node, upstream, downstream, suggestions: null });
      fetch("/api/qa-map/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removed: node, upstream, downstream }),
      })
        .then((r) => r.json())
        .then((d: RepairSuggestion) => setRepair((r) => (r ? { ...r, suggestions: d } : null)))
        .catch(() => setRepair((r) => (r ? { ...r, suggestions: { links: [], summary: "" } } : null)));
      return;
    }
    pushHistory();
    // 删节点及其全部入边/出边
    const next = a.nodes.filter((n) => n.id !== node.id);
    const nextEdges = edges.filter((e) => e.from !== node.id && e.to !== node.id);
    patchActiveRef.current({ nodes: next, edges: nextEdges, selectedId: null });
  }, [pushHistory]);

  // 删卡并接续（B）：删节点 + 落 AI 建议的上下游连线
  const confirmRepair = useCallback(
    (links: RepairSuggestion["links"]) => {
      const r = repairRef.current;
      const a = activeRef.current;
      if (!r || !a) return;
      pushHistory();
      const nodes = a.nodes.filter((n) => n.id !== r.node.id);
      let edges = (a.edges ?? []).filter((e) => e.from !== r.node.id && e.to !== r.node.id);
      for (const l of links) {
        if (!nodes.some((n) => n.id === l.from) || !nodes.some((n) => n.id === l.to)) continue;
        if (edges.some((e) => e.from === l.from && e.to === l.to)) continue;
        if (hasCycle(nodes, edges, l.from, l.to)) continue;
        edges = [...edges, { id: edgeId(l.from, l.to), from: l.from, to: l.to, ...(l.relFrom ? { relFrom: l.relFrom } : {}), ...(l.relTo ? { relTo: l.relTo } : {}) }];
      }
      patchActiveRef.current({ nodes, edges, selectedId: null });
      setRepair(null);
      setNotice(`已删除并接续 ${links.length} 条连线（Ctrl+Z 可撤销）`);
    },
    [pushHistory]
  );

  const deleteOnly = useCallback(() => {
    const r = repairRef.current;
    const a = activeRef.current;
    if (!r || !a) return;
    pushHistory();
    const nodes = a.nodes.filter((n) => n.id !== r.node.id);
    const edges = (a.edges ?? []).filter((e) => e.from !== r.node.id && e.to !== r.node.id);
    patchActiveRef.current({ nodes, edges, selectedId: null });
    setRepair(null);
  }, [pushHistory]);

  // 体检连线修复（A）：增/删边，可撤销
  const applyEdgeOps = useCallback(
    (add: Array<{ from: string; to: string; relFrom?: string; relTo?: string }> | undefined, remove: string[]) => {
      const a = activeRef.current;
      if (!a) return;
      pushHistory();
      let edges = (a.edges ?? []).filter((e) => !remove.includes(e.id));
      for (const op of add ?? []) {
        if (!a.nodes.some((n) => n.id === op.from) || !a.nodes.some((n) => n.id === op.to)) continue;
        if (hasCycle(a.nodes, edges, op.from, op.to)) continue;
        const i = edges.findIndex((e) => e.from === op.from && e.to === op.to);
        if (i >= 0) {
          edges = edges.map((e, idx) =>
            idx === i ? { ...e, ...(op.relFrom ? { relFrom: op.relFrom.slice(0, 40) } : {}), ...(op.relTo ? { relTo: op.relTo.slice(0, 40) } : {}) } : e
          );
        } else {
          edges = [
            ...edges,
            {
              id: edgeId(op.from, op.to),
              from: op.from,
              to: op.to,
              ...(op.relFrom ? { relFrom: op.relFrom.slice(0, 40) } : {}),
              ...(op.relTo ? { relTo: op.relTo.slice(0, 40) } : {}),
            },
          ];
        }
      }
      patchActiveRef.current({ edges });
      setNotice("已应用连线修复（Ctrl+Z 可撤销）");
    },
    [pushHistory]
  );

  // 重复卡合并（D）：AI 融合内容 + 边重定向到保留卡
  const applyMerge = useCallback(
    async (cardIds: string[]) => {
      const a = activeRef.current;
      if (!a || cardIds.length < 2) return;
      const cards = a.nodes.filter((n) => cardIds.includes(n.id));
      if (cards.length < 2) return;
      setNotice("正在合并卡片…");
      try {
        const r = await fetch("/api/qa-map/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards }),
        });
        const d = (await r.json()) as { title?: string; question?: string; answer?: string; summary?: string; error?: string };
        if (!r.ok || d.error) throw new Error(d.error || "合并失败");
        pushHistory();
        const [keepId, ...removeIds] = cardIds;
        const nodes = a.nodes
          .filter((n) => !removeIds.includes(n.id))
          .map((n) =>
            n.id === keepId
              ? { ...n, title: String(d.title ?? n.title).slice(0, 40), question: String(d.question ?? n.question), answer: String(d.answer ?? n.answer) }
              : n
          );
        const seen = new Set<string>();
        const edges: QaMapEdge[] = [];
        for (const e of a.edges ?? []) {
          const from = removeIds.includes(e.from) ? keepId : e.from;
          const to = removeIds.includes(e.to) ? keepId : e.to;
          if (from === to || !nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to)) continue;
          const pair = `${from}->${to}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          edges.push({ ...e, id: edgeId(from, to), from, to });
        }
        patchActiveRef.current({ nodes, edges, selectedId: keepId });
        setNotice(`${d.summary || "已合并卡片"}（Ctrl+Z 可撤销）`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pushHistory]
  );

  // ── 受控节点：只应用拖动 position（实时跟手，不落库）。
  //    不接 onNodesChange 拖动会让卡片消失（历史 bug）；
  //    dimensions 事件绝不回写 state —— 回写会形成「测量→回写→重测」死循环，
  //    导致 fit 被疯狂调用（本 bug 根因），且卡片尺寸本由自身 style 控制 ──
  const onNodesChange = useCallback(
    (changes: NodeChange<QaMapRFNode>[]) => {
      const posById = new Map<string, { x: number; y: number }>();
      for (const c of changes) {
        if (c.type === "position" && c.position) posById.set(c.id, c.position);
      }
      if (posById.size === 0) return;
      setTabs((prev) =>
        prev.map((t) => {
          const key = activeKey || prev[0].key;
          if (t.key !== key) return t;
          return {
            ...t,
            nodes: t.nodes.map((n) => {
              const pos = posById.get(n.id);
              return pos ? { ...n, x: pos.x, y: pos.y } : n;
            }),
          };
        })
      );
    },
    [activeKey]
  );

  // ── 自定义连线：拖锚点到另一张卡 → 弹窗填两端标注 → 建边（防环/同向去重） ──
  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    const a = activeRef.current;
    if (!a) return;
    if (conn.source === conn.target || hasCycle(a.nodes, a.edges ?? [], conn.source, conn.target)) {
      setError("不能连回自己或上游（会形成循环），已拒绝");
      return;
    }
    if ((a.edges ?? []).some((e) => e.from === conn.source && e.to === conn.target)) {
      setNotice("这两个卡片之间已有同向连线");
      return;
    }
    setPendingConn({ from: conn.source, to: conn.target });
  }, []);

  // ── 弹窗确认：追加边（标注留空则 AI 异步补生成） ──
  const pendingConnRef = useRef<{ from: string; to: string } | null>(null);
  pendingConnRef.current = pendingConn;
  const repairRef = useRef<typeof repair>(null);
  repairRef.current = repair;
  const confirmEdge = useCallback((relFrom: string, relTo: string) => {
    const pc = pendingConnRef.current;
    const a = activeRef.current;
    if (!pc || !a) return;
    const eid = edgeId(pc.from, pc.to);
    pushHistory();
    const e: QaMapEdge = {
      id: eid,
      from: pc.from,
      to: pc.to,
      ...(relFrom.trim() ? { relFrom: relFrom.trim().slice(0, 40) } : {}),
      ...(relTo.trim() ? { relTo: relTo.trim().slice(0, 40) } : {}),
    };
    patchActiveRef.current({ edges: [...(a.edges ?? []), e] });
    setPendingConn(null);
    // 标注留空 → AI 异步补生成（失败保持无标注，边仍可点选/编辑/删除）
    if (!relFrom.trim() || !relTo.trim()) {
      const fromNode = a.nodes.find((n) => n.id === pc.from);
      const toNode = a.nodes.find((n) => n.id === pc.to);
      if (fromNode && toNode) {
        setNotice("已建立连线，AI 正在生成标注…");
        fetch("/api/qa-map/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromNode, to: toNode }),
        })
          .then((r) => r.json())
          .then((d: { relFrom?: string; relTo?: string }) => {
            patchActiveRef.current({
              edges: (activeRef.current?.edges ?? []).map((x) =>
                x.id === eid
                  ? {
                      ...x,
                      ...(d.relFrom && !x.relFrom ? { relFrom: d.relFrom } : {}),
                      ...(d.relTo && !x.relTo ? { relTo: d.relTo } : {}),
                    }
                  : x
              ),
            });
            setNotice("AI 标注已生成（不满意可点标注修改）");
          })
          .catch(() => setNotice("AI 标注生成失败，可点边手动填写"));
      }
    }
  }, []);

  // ── 点边端：两端标注独立编辑（点哪端改哪端）/ 断开 ──
  const applyEdgeRelation = useCallback(() => {
    if (!selectedEdge) return;
    const { edgeId: eid, end, draft } = selectedEdge;
    const value = draft.trim().slice(0, 40);
    pushHistory();
    patchActive({
      edges: (active.edges ?? []).map((e) =>
        e.id === eid ? (end === "from" ? { ...e, relFrom: value || undefined } : { ...e, relTo: value || undefined }) : e
      ),
    });
    setSelectedEdge(null);
  }, [active, patchActive, selectedEdge]);

  const disconnectEdge = useCallback(() => {
    if (!selectedEdge) return;
    pushHistory();
    patchActive({
      edges: (active.edges ?? []).filter((e) => e.id !== selectedEdge.edgeId),
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
  const openingRef = useRef<Set<number>>(new Set()); // 正在拉取的地图（防连点重复开标签）
  function openHistory(id: number) {
    const existing = tabs.find((t) => t.mapId === id);
    if (existing) {
      setActiveKey(existing.key);
      return;
    }
    if (openingRef.current.has(id)) return; // 首次点击还在拉取中：吞掉连点
    openingRef.current.add(id);
    fetch(`/api/artifacts/${id}`)
      .then((r) => r.json())
      .then((d) => {
        try {
          const map = normalizeQaMap(JSON.parse(d.content ?? "")); // 旧格式自动迁移为边表
          if (!map) throw new Error("bad");
          const t: MapTab = {
            key: `m${Date.now().toString(36)}${tabSeq++}`,
            mapId: id,
            title: map.title || d.title || "知识地图",
            nodes: map.nodes ?? [],
            edges: map.edges ?? [],
            selectedId: null,
            projectScope: map.projectScope ?? [],
          };
          setTabs((prev) => {
            // 双保险：拉取期间若已被别的路径添加（如新追问自动建卡），不再重复
            if (prev.some((x) => x.mapId === id)) return prev;
            return [...prev, t];
          });
          setActiveKey(t.key);
          setNotice(`已打开《${t.title}》`);
        } catch {
          setError("地图数据损坏");
        } finally {
          openingRef.current.delete(id);
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
        edges: map.edges ?? [],
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
    const data: QaMapData = { title: active.title, nodes: active.nodes, edges: active.edges ?? [], projectScope: active.projectScope ?? [] };
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

  // ── React Flow 数据：对象复用缓存 —— 仅被操作的卡片产生新对象/新 data，
  //    其余节点引用不变 → RF 的 store selector 浅比较跳过 → 拖动/缩放零重渲染（闪烁根治） ──
  const cardHandlers = useMemo(
    () => ({ onFollowUp, onCite, onDelete, onResize, onResizeEnd }),
    [onFollowUp, onCite, onDelete, onResize, onResizeEnd]
  );
  const nodeCacheRef = useRef(new Map<string, QaMapRFNode>());
  const rfNodes = useMemo<QaMapRFNode[]>(() => {
    const a = active;
    const cache = nodeCacheRef.current;
    const keep = new Set<string>();
    const list = (a?.nodes ?? []).map((n) => {
      keep.add(n.id);
      const busy = busyKey === a?.key;
      const selected = n.id === a?.selectedId;
      const prev = cache.get(n.id);
      if (prev && prev.position.x === n.x && prev.position.y === n.y && prev.selected === selected && prev.data.node === n && prev.data.busy === busy) {
        return prev;
      }
      const next: QaMapRFNode = {
        id: n.id,
        type: "qaCard",
        position: { x: n.x, y: n.y },
        selected,
        data: { node: n, ...cardHandlers, busy },
      };
      cache.set(n.id, next);
      return next;
    });
    for (const key of [...cache.keys()]) if (!keep.has(key)) cache.delete(key);
    return list;
  }, [active, busyKey, cardHandlers]);

  const ready = sources.filter((s) => s.status === "ready");
  const attachNode = active?.selectedId ? active.nodes.find((n) => n.id === active.selectedId) : null;

  // ── 打开/切换地图后视口自适配：不信任 RF 内置 fitView（它对本项目算出过
  //    scale(0.31) 卡片缩成看不清的黑盒结果），改为自算：节点包围盒 ÷ 画布真实 DOM 尺寸
  //    → setViewport；150/600ms 双时机兜底 ──
  const rfInstanceRef = useRef<ReactFlowInstance<QaMapRFNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fitActive = useCallback(() => {
    const now = Date.now();
    if (now - lastFitRef.current < 250) return; // 防抖：杜绝任何路径下的狂调
    lastFitRef.current = now;
    const nodes = active?.nodes ?? [];
    const inst = rfInstanceRef.current;
    const box = canvasRef.current;
    if (!inst || !box || nodes.length === 0) return;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + (n.w ?? 340)));
    const maxY = Math.max(...nodes.map((n) => n.y + (n.h ?? 280)));
    const boxW = Math.max(maxX - minX, 1);
    const boxH = Math.max(maxY - minY, 1);
    const rect = box.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    // 下限 0.4：分屏/极小窗口下也不缩成看不清的糊团（宁可溢出可拖动）
    const zoom = Math.min(Math.max(Math.min((rect.width - 80) / boxW, (rect.height - 140) / boxH), 0.4), 1);
    const x = (rect.width - boxW * zoom) / 2 - minX * zoom;
    const y = (rect.height - boxH * zoom) / 2 - minY * zoom;
    void inst.setViewport({ x, y, zoom }, { duration: 300 });
  }, [active]);
  const fitActiveRef = useRef(fitActive);
  fitActiveRef.current = fitActive;
  const lastFitRef = useRef(0);
  useEffect(() => {
    const t1 = setTimeout(() => fitActiveRef.current(), 150);
    const t2 = setTimeout(() => fitActiveRef.current(), 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeKey, active?.mapId]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 右侧常驻解题对话（P4 定稿 §3.4：知识地图模块独享解题对话；先挂后置避免改画布内部结构） */}

      {/* 左栏：共享资源栏（视图 = 仅 ready）；地图管理挂 topSlot */}
      <div className="flex w-[260px] shrink-0 flex-col">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">解题答疑</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">问答成卡片 · 追问成地图 · 沉淀知识库</div>
        </div>
        {error && (
          <div className="mx-3 mt-2 border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>
        )}
        {notice && (
          <div className="mx-3 mt-2 border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">{notice}</div>
        )}
        <div className="min-h-0 flex-1">
          <FilesPanel
            sources={ready}
            artifacts={[]}
            categories={categories}
            genError={null}
            selected={contextIds}
            selectedArts={new Set()}
            onToggleSource={lib.toggleSelect}
            onToggleArtifact={() => {}}
            onToggleFolder={lib.toggleFolderSelect}
            onToggleAll={lib.toggleSelectAll}
            onUpload={lib.upload}
            onAddLink={lib.addLink}
            onAddText={lib.addText}
            onDeleteSource={lib.removeSource}
            onDeleteArtifact={async () => {}}
            onDeleteCategory={lib.removeCategory}
            onNewCategory={lib.newCategory}
            onMoveSource={lib.moveSource}
            onMoveArtifact={async () => {}}
            onOpenSource={(s) => setPreviewSource(s)}
            sectionTitle={contextIds.size > 0 ? `资源 · 依据 ${contextIds.size}` : "资源"}
            emptyText="暂无资料（可先去工作台上传）"
            topBarExtra={
              <button onClick={lib.clearSelection} className="text-[11px] text-neutral-400 hover:text-neutral-900">
                清空
              </button>
            }
            topSlot={
              <div className="px-3 pt-2.5 pb-1">
                {/* 地图管理区：限高自滚 */}
                <div className="max-h-[180px] overflow-y-auto">
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
                </div>
              </div>
            }
            bottomSlot={
              <p className="border-t border-neutral-200 px-3 py-2 text-[10px] text-neutral-400">
                勾选资源 = 指定答题依据（右栏胶囊可移除）；不指定 = 自动检索
              </p>
            }
          />
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={undo}
              disabled={historyRef.current.past.length === 0}
              title="撤销（Ctrl+Z）"
              className="border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-30">
              ↩
            </button>
            <button
              onClick={redo}
              disabled={historyRef.current.future.length === 0}
              title="重做（Ctrl+Y）"
              className="border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-30">
              ↪
            </button>
            <button
              onClick={applyAutoLayout}
              title="按连线关系分层排列全部卡片（可撤销）"
              className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
              ⊹ 整理布局
            </button>
            <button
              onClick={() => setAnalyzeOpen(true)}
              title="AI 诊断孤立卡/重复卡/断链并一键修复"
              className="border border-emerald-600 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
              ◎ AI 体检
            </button>
          </div>
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
          <div ref={canvasRef} className="relative min-w-0 flex-1">
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
                minZoom={0.1}
                nodesDraggable
                nodesConnectable
              >
                <div className="pointer-events-none absolute inset-0 z-[6] flex items-end justify-end p-3">
                  <button
                    onClick={() => fitActive()}
                    title="适配全部卡片"
                    className="pointer-events-auto rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-600 shadow hover:bg-neutral-50"
                  >
                    ⛶ 回到视图
                  </button>
                </div>
                <Background gap={20} size={1} color="#ececec" />
                <Controls showInteractive={false} showFitView={false} />
                {/* 连线层：自绘 SVG（RF 边管道不可靠，自绘稳定且可交互） */}
                <EdgesOverlay
                  nodes={active?.nodes ?? []}
                  edges={active?.edges ?? []}
                  selectedEdgeId={selectedEdge?.edgeId}
                  onEdgeClick={(edgeId, end) => {
                    const edge = (active.edges ?? []).find((e) => e.id === edgeId);
                    if (!edge) return;
                    setSelectedEdge({
                      edgeId,
                      end,
                      draft: (end === "from" ? edge.relFrom : edge.relTo) ?? "",
                    });
                  }}
                />
              </ReactFlow>
            )}

            {/* 手动连线弹窗：填两端标注（可留空）后建边 */}
            {pendingConn && (
              <EdgeDialog
                nodes={active?.nodes ?? []}
                from={pendingConn.from}
                to={pendingConn.to}
                onCancel={() => setPendingConn(null)}
                onConfirm={confirmEdge}
              />
            )}

            {/* 删卡智能修复弹窗（B）：中间卡删除时 AI 建议接续 */}
            {repair && (
              <RepairDialog
                node={repair.node}
                upstream={repair.upstream}
                downstream={repair.downstream}
                suggestions={repair.suggestions}
                onConfirmRepair={confirmRepair}
                onDeleteOnly={deleteOnly}
                onCancel={() => setRepair(null)}
              />
            )}

            {/* AI 地图体检弹窗（A）：诊断 + 一键修复 */}
            {analyzeOpen && (
              <AnalyzeDialog
                nodes={active?.nodes ?? []}
                edges={active?.edges ?? []}
                onApplyEdgeOps={applyEdgeOps}
                onMerge={(ids) => void applyMerge(ids)}
                onClose={() => setAnalyzeOpen(false)}
              />
            )}

            {/* 边编辑：改关系词 / 断开连线 */}
            {selectedEdge && (
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-lg">
                <span className="text-[11px] text-neutral-500">
                  {selectedEdge.end === "from" ? "源端标注 · 目标卡相对源卡" : "目标端标注 · 源卡相对目标卡"}
                </span>
                <input
                  value={selectedEdge.draft}
                  onChange={(e) => setSelectedEdge({ ...selectedEdge, draft: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && applyEdgeRelation()}
                  className="w-40 rounded border border-neutral-200 px-2 py-1 text-[11px] outline-none focus:border-neutral-400"
                  placeholder="关系标注（如：前提：线性时不变假设）"
                  autoFocus
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

            {/* 底部悬浮问答框已删（2026-11-15 用户反馈）：地图问答迁入右栏「解题对话」，避免与工作对话混淆 */}
          </div>

          {/* 右侧预览抽屉 */}
          <SourcePreviewDrawer source={previewSource} onClose={() => setPreviewSource(null)} />

        </div>
      </main>

      {/* 右栏：解题对话（地图问答专用，走 /api/ask 生成卡片；2026-11-15 用户反馈：替代底部悬浮框） */}
      <div className="flex w-[340px] shrink-0 flex-col border-l border-neutral-300">
        {/* 标题与范围：地图问答的归属信息 */}
        <div className="border-b border-neutral-100 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-neutral-700">解题对话</span>
            <span className="relative">
              <button
                onClick={() => setScopeOpen((o) => !o)}
                title="限定答题检索的项目范围"
                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50"
              >
                范围：{(active?.projectScope ?? []).length ? `${active!.projectScope!.length} 项目` : "全部"}
              </button>
              {scopeOpen && (
                <div className="absolute right-0 top-6 z-20 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
                  <p className="px-1 pb-1 text-[10px] text-neutral-400">勾选项目限定答题检索范围（不选=全部项目）</p>
                  {projects.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={(active?.projectScope ?? []).includes(p.id)}
                        onChange={() => toggleScope(p.id)}
                      />
                      {p.title}
                    </label>
                  ))}
                  {projects.length === 0 && <p className="px-1 py-1 text-[10px] text-neutral-300">暂无项目</p>}
                </div>
              )}
            </span>
          </div>
          {/* 指定依据胶囊（原底部悬浮框的勾选联动） */}
          {contextIds.size > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[...contextIds].map((id) => (
                <span key={id} className="flex max-w-[140px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                  <span className="truncate">{sources.find((s) => s.id === id)?.title ?? id}</span>
                  <button onClick={() => lib.removeSelection(id)} className="text-violet-400 hover:text-violet-700">×</button>
                </span>
              ))}
            </div>
          )}
          {attachNode && (
            <p className="mt-1.5 truncate text-[10px] text-amber-700">↳ 追问将挂到选中卡「{attachNode.title}」</p>
          )}
        </div>

        {/* 卡片流：本地图的问答结果（新卡/追问/整理在画布上呈现） */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px] leading-5 text-neutral-600">
          {busyKey ? (
            <p className="text-neutral-400">思考中…（卡片生成后自动挂上画布）</p>
          ) : attachNode ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
              <p className="text-[10px] font-medium text-amber-700">当前追问目标</p>
              <p className="mt-1 font-medium text-neutral-800">{attachNode.title}</p>
              <p className="mt-0.5 line-clamp-3 text-[11px] text-neutral-500">{attachNode.question}</p>
            </div>
          ) : (
            <p className="text-neutral-400">在下方输入问题；新问题会生成新卡挂上地图，与已有卡相关时自动连线。</p>
          )}
          {error && <p className="mt-2 text-red-600">{error}</p>}
          {notice && <p className="mt-2 text-emerald-700">{notice}</p>}
        </div>

        {/* 输入区：📷拍题 + 问题（Enter 发送） */}
        <div className="border-t border-neutral-100 p-2">
          <div className="flex items-start gap-1.5">
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
                  if (input.trim() && !busyKey) void ask(input.trim());
                }
              }}
              rows={2}
              placeholder={
                attachNode
                  ? `追问「${attachNode.title}」…（不相关自动开新话题）`
                  : "输入问题，Enter 发送…"
              }
              className="min-w-0 flex-1 resize-none rounded border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            <button
              onClick={() => input.trim() && !busyKey && void ask(input.trim())}
              disabled={!!busyKey || !input.trim()}
              className="mt-1 shrink-0 rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {busyKey ? "…" : "发送"}
            </button>
          </div>
          {image && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt="" className="h-5 w-5 object-cover" />
              <span className="truncate">{image.name}</span>
              <button onClick={() => setImage(null)} className="text-neutral-400 hover:text-red-600">×</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
