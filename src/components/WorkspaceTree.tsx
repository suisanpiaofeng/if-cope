"use client";

/** 工作区文件树（harness P0 §3.3）：浏览/新建/上传/下载/删除（二次确认）；点击文件 → 预览/编辑 */
import { useEffect, useState } from "react";

type WNode = { name: string; path: string; type: "dir" | "file"; size?: number; mtime?: number };

export default function WorkspaceTree({ onOpenFile }: { onOpenFile: (path: string, name: string) => void }) {
  const [children, setChildren] = useState<Record<string, WNode[]>>({ "": [] });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "": true });
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function loadDir(dir: string) {
    const r = await fetch(`/api/workspace/file?path=${encodeURIComponent(dir)}`).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.type === "dir") setChildren((c) => ({ ...c, [dir]: d.entries ?? [] }));
    else if (d?.error) setErr(d.error);
  }
  useEffect(() => {
    loadDir("");
  }, []);

  async function put(path: string, content: string, mkdir = false) {
    const r = await fetch("/api/workspace/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, mkdir }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) {
      setErr(d?.error ?? "写入失败");
      return false;
    }
    return true;
  }

  async function refresh(dir: string) {
    await loadDir(dir);
    // 同步刷新父级（新建/删除后）
    const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    await loadDir(parent);
  }

  async function createFile() {
    const name = prompt("新文件名（含扩展名，如 main.ts）")?.trim();
    if (!name) return;
    if (await put(name, "")) {
      setMsg(`已创建 ${name}`);
      refresh("");
    }
  }

  async function createFolder() {
    const name = prompt("新文件夹名")?.trim();
    if (!name) return;
    if (await put(name, "", true)) {
      setMsg(`已创建文件夹 ${name}`);
      refresh("");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    let n = 0;
    for (const f of Array.from(files)) {
      const buf = await f.arrayBuffer();
      if (new Uint8Array(buf).includes(0)) {
        setErr(`跳过二进制文件：${f.name}（P0 仅支持文本文件）`);
        continue;
      }
      if (await put(f.name, await f.text())) n++;
    }
    if (n) {
      setMsg(`已上传 ${n} 个文件`);
      refresh("");
    }
  }

  async function download(node: WNode) {
    const r = await fetch(`/api/workspace/file?path=${encodeURIComponent(node.path)}`);
    const d = await r.json();
    if (d.error) return setErr(d.error);
    const blob = new Blob([d.content ?? ""], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove(node: WNode) {
    const r = await fetch(`/api/workspace/file?path=${encodeURIComponent(node.path)}`, { method: "DELETE" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) setErr(d?.error ?? "删除失败");
    else {
      setMsg(`已删除 ${node.name}`);
      const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
      refresh(parent);
    }
    setConfirmPath(null);
  }

  function Row({ node, level }: { node: WNode; level: number }) {
    const isOpen = expanded[node.path];
    return (
      <div>
        <div
          className="group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-100"
          style={{ paddingLeft: 8 + level * 14 }}
          onClick={() => {
            if (node.type === "dir") {
              setExpanded((e) => ({ ...e, [node.path]: !e[node.path] }));
              if (!children[node.path]) loadDir(node.path);
            } else {
              onOpenFile(node.path, node.name);
            }
          }}
        >
          <span className="shrink-0 text-[11px] text-neutral-400">{node.type === "dir" ? (isOpen ? "📂" : "📁") : "📄"}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-700" title={node.path}>{node.name}</span>
          {node.type === "file" && (
            <span className="hidden shrink-0 gap-1 group-hover:flex">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  download(node);
                }}
                title="下载"
                className="text-[10px] text-neutral-400 hover:text-neutral-900"
              >
                ⬇
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmPath === node.path) remove(node);
                  else {
                    setConfirmPath(node.path);
                    setTimeout(() => setConfirmPath((p) => (p === node.path ? null : p)), 3000);
                  }
                }}
                title="删除"
                className={`text-[10px] ${confirmPath === node.path ? "text-red-600" : "text-neutral-400 hover:text-red-600"}`}
              >
                {confirmPath === node.path ? "确认删除？" : "✕"}
              </button>
            </span>
          )}
        </div>
        {node.type === "dir" && isOpen && (
          <div>
            {(children[node.path] ?? []).map((c) => (
              <Row key={c.path} node={c} level={level + 1} />
            ))}
            {(children[node.path] ?? []).length === 0 && (
              <p className="text-[11px] text-neutral-300" style={{ paddingLeft: 22 + level * 14 }}>空目录</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">工作区文件</span>
        <div className="flex gap-1.5 text-[11px]">
          <button onClick={createFile} className="text-neutral-400 hover:text-neutral-900">＋ 文件</button>
          <button onClick={createFolder} className="text-neutral-400 hover:text-neutral-900">＋ 文件夹</button>
          <label className="cursor-pointer text-neutral-400 hover:text-neutral-900">
            ⬆ 上传
            <input type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
          </label>
        </div>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto px-2 pb-2 ${dragOver ? "outline-2 outline-dashed outline-violet-300" : ""}`}>
        {(children[""] ?? []).map((n) => (
          <Row key={n.path} node={n} level={0} />
        ))}
        {(children[""] ?? []).length === 0 && (
          <p className="px-2 py-2 text-[11px] text-neutral-300">
            {dragOver ? "松开上传到工作区" : "空工作区：可新建/上传文件，或把文件/文件夹拖进来；也可在对话里让 AI 创建"}
          </p>
        )}
      </div>
      {msg && <p className="px-3 pb-2 text-[11px] text-emerald-700">{msg}</p>}
      {err && <p className="px-3 pb-2 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
