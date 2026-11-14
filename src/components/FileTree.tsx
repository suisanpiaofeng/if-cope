"use client";

/** 统一文件树（harness P3-2，规格 §5）：一棵树 = 唯一文件空间（OpenNote 内核）。
 *  行=文件/文件夹；📚N块=问答索引（点按开关，文件不动）；筛选条=全部/已入库/类型。
 *  位置=路径：上传落目录、AI 生成落目录、入库只是挂索引。 */
import { useEffect, useMemo, useState } from "react";
import UploadModal from "./UploadModal";

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  mtime?: number;
  kind?: string | null;
  sourceId?: number | null;
  indexed?: boolean;
  chunkCount?: number;
  artifact?: boolean;
};

type Node = TreeNode & { children: Node[] };

type FilterMode = "all" | "indexed" | "note" | "doc" | "code" | "artifact" | "other";

const FILTERS: Array<[FilterMode, string]> = [
  ["all", "全部"],
  ["indexed", "📚 已入库"],
  ["note", "笔记"],
  ["doc", "课件"],
  ["code", "代码"],
  ["artifact", "产物"],
  ["other", "其他"],
];

function kindOf(n: TreeNode): FilterMode {
  const k = n.kind;
  if (k === "markdown" || k === "text") return "note";
  if (k === "pdf" || k === "docx") return "doc";
  if (k === "code") return "code";
  return "other";
}

export default function FileTree({
  selected, onToggleSelect, onOpenSource, onOpenFile,
  categories, onUpload, onAddLink, onAddText,
}: {
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onOpenSource: (sourceId: number) => void;
  onOpenFile: (path: string, name: string) => void;
  categories: { id: number; name: string }[];
  onUpload: (files: File[], categoryId: number | null, type: string, opts?: { path?: string; autoIndex?: boolean }) => Promise<void>;
  onAddLink: (url: string, categoryId: number | null) => Promise<void>;
  onAddText: (text: string, categoryId: number | null) => Promise<void>;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "": true, "资料": true });
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    fetch("/api/files/tree")
      .then((r) => r.json())
      .then((d: { nodes?: TreeNode[] }) => setNodes(d.nodes ?? []))
      .catch(() => setNodes([]));
  }
  useEffect(() => {
    load();
  }, []);

  // 扁平 → 嵌套（按路径分组）
  const tree = useMemo(() => {
    const root: Node[] = [];
    const byPath = new Map<string, Node>();
    for (const n of nodes) byPath.set(n.path, { ...n, children: [] });
    for (const n of byPath.values()) {
      const parent = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
      const p = byPath.get(parent);
      (p ? p.children : root).push(n);
    }
    const sortRec = (arr: Node[]) => {
      arr.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      arr.forEach((x) => sortRec(x.children));
    };
    sortRec(root);
    return root;
  }, [nodes]);

  const match = (n: TreeNode): boolean => {
    if (query && !n.path.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "indexed") return Boolean(n.indexed);
    if (filter === "artifact") return Boolean(n.artifact);
    if (filter !== "all") return n.type === "file" && kindOf(n) === filter;
    return true;
  };

  // 目录可见性：自身或任一后代命中
  const dirVisible = (n: Node): boolean => n.type === "dir" ? n.children.some(dirVisible) || match(n) : match(n);

  async function toggleIndex(n: TreeNode) {
    if (!n.sourceId) return;
    const on = !n.indexed;
    const r = await fetch(`/api/sources/${n.sourceId}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) setErr(d?.error ?? "索引开关失败");
    else setMsg(on ? `《${n.name}》已入库（问答可用）` : `《${n.name}》已出库（文件保留）`);
    load();
  }

  async function remove(n: TreeNode) {
    const r = await fetch(
      n.sourceId ? `/api/sources/${n.sourceId}` : `/api/workspace/file?path=${encodeURIComponent(n.path)}`,
      { method: "DELETE" }
    ).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) setErr(d?.error ?? "删除失败");
    else setMsg(`已删除 ${n.name}`);
    setConfirmDel(null);
    load();
  }

  function open(n: TreeNode) {
    if (n.sourceId) onOpenSource(n.sourceId);
    else onOpenFile(n.path, n.name);
  }

  async function newCourse() {
    const name = prompt("课程名称（如 高数）")?.trim();
    if (!name) return;
    const r = await fetch("/api/files/template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) setErr(d?.error ?? "创建失败");
    else {
      setMsg(`已创建课程空间「${name}」（讲义/作业/错题本/复习计划）`);
      setExpanded((e) => ({ ...e, [name]: true }));
      load();
    }
  }

  function Row({ node, level }: { node: Node; level: number }) {
    const isOpen = expanded[node.path];
    const dim = node.path.startsWith(".ifcope");
    return (
      <div>
        <div
          className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-[3px] hover:bg-neutral-100"
          style={{ paddingLeft: 6 + level * 13 }}
          onClick={() => {
            if (node.type === "dir") setExpanded((e) => ({ ...e, [node.path]: !e[node.path] }));
            else open(node);
          }}
        >
          {node.type === "file" && node.sourceId ? (
            <input
              type="checkbox"
              checked={selected.has(node.sourceId)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(node.sourceId!)}
              title="勾选后参与对话问答"
              className="shrink-0"
            />
          ) : (
            <span className="w-[13px] shrink-0" />
          )}
          <span className="shrink-0 text-[11px] text-neutral-400">
            {node.type === "dir" ? (isOpen ? "📂" : "📁") : dim ? "⚙" : "📄"}
          </span>
          <span className={`min-w-0 flex-1 truncate text-[12px] ${dim ? "text-neutral-300" : "text-neutral-700"}`} title={node.path}>
            {node.name}
          </span>
          {node.type === "file" && node.indexed && (
            <span className="shrink-0 rounded bg-emerald-50 px-1 text-[9px] text-emerald-700">📚{node.chunkCount}块</span>
          )}
          {node.type === "file" && node.sourceId && !node.indexed && (
            <span className="shrink-0 rounded bg-neutral-100 px-1 text-[9px] text-neutral-400">未入库</span>
          )}
          {node.type === "file" && node.artifact && (
            <span className="shrink-0 rounded bg-violet-50 px-1 text-[9px] text-violet-600">产物</span>
          )}
          {node.type === "file" && (
            <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
              {node.sourceId && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleIndex(node); }}
                  title={node.indexed ? "出库（删索引，文件保留）" : "入库（解析后可问答）"}
                  className="text-[10px] text-neutral-400 hover:text-emerald-600"
                >{node.indexed ? "📚×" : "📚+"}</button>
              )}
              <a
                href={`/api/workspace/download?path=${encodeURIComponent(node.path)}`}
                onClick={(e) => e.stopPropagation()}
                title="下载"
                className="text-[10px] text-neutral-400 hover:text-neutral-900"
              >⬇</a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmDel === node.path) remove(node);
                  else {
                    setConfirmDel(node.path);
                    setTimeout(() => setConfirmDel((p) => (p === node.path ? null : p)), 3000);
                  }
                }}
                title="删除"
                className={`text-[10px] ${confirmDel === node.path ? "text-red-600" : "text-neutral-400 hover:text-red-600"}`}
              >{confirmDel === node.path ? "确认删除？" : "✕"}</button>
            </span>
          )}
        </div>
        {node.type === "dir" && isOpen && (
          <div>
            {node.children.filter(dirVisible).map((c) => (
              <Row key={c.path} node={c} level={level + 1} />
            ))}
            {node.children.filter(dirVisible).length === 0 && (
              <p className="text-[11px] text-neutral-300" style={{ paddingLeft: 20 + level * 13 }}>空目录</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏：搜索 + 上传 */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文件…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-neutral-400"
        />
        <button
          onClick={newCourse}
          title="生成课程文件夹骨架（讲义/作业/错题本/复习计划）"
          className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
        >＋ 课程</button>
        <button
          onClick={() => setUploadOpen(true)}
          className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-700"
        >＋ 上传</button>
      </div>
      {/* 筛选条 */}
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              filter === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
            }`}
          >{label}</button>
        ))}
      </div>

      {/* 树 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tree.filter(dirVisible).map((n) => (
          <Row key={n.path} node={n} level={0} />
        ))}
        {tree.filter(dirVisible).length === 0 && (
          <p className="px-2 py-3 text-[11px] text-neutral-300">无匹配文件。上传资料或让 AI 在工作区创建文件。</p>
        )}
      </div>

      {msg && <p className="px-3 pb-2 text-[11px] text-emerald-700">{msg}</p>}
      {err && <p className="px-3 pb-2 text-[11px] text-red-600">{err}</p>}

      <UploadModal
        open={uploadOpen}
        defaultCategoryId={null}
        categories={categories}
        onClose={() => setUploadOpen(false)}
        onUpload={async (files, catId, opts) => {
          await onUpload(files, catId, "其他", opts);
          load();
        }}
        onAddLink={async (u, catId) => {
          await onAddLink(u, catId);
          load();
        }}
        onAddText={async (t, catId) => {
          await onAddText(t, catId);
          load();
        }}
      />
    </div>
  );
}
