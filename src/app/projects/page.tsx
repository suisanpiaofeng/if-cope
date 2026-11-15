"use client";

/** 项目管理页（OpenFic 对齐定稿 §3.4）：卡片网格、新建（仅名称/描述）、搜索、删除强确认。
 *  项目=自由工作空间=顶层目录；进入项目=项目视图（文件树|预览|对话）。 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { projectTileClasses, projectInitial } from "@/lib/recentProjects";

type Project = {
  id: number;
  title: string;
  description: string | null;
  dir: string;
  created_at: number;
  sourceCount: number;
  artifactCount: number;
};

export default function ProjectsPage() {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: { projects?: Project[] }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setConfigured(d.hasKey && Boolean(d.baseUrl && d.chatModel)))
      .catch(() => setConfigured(null));
    // 懒迁移（幂等）：旧顶层目录自动升级为项目
    fetch("/api/projects/migrate", { method: "POST" }).finally(load);
  }, []);

  async function create() {
    const title = draftTitle.trim();
    if (!title) return setErr("请填写项目名称");
    setErr(null);
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: draftDesc.trim() }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) return setErr(d?.error ?? "创建失败");
    setCreating(false);
    setDraftTitle("");
    setDraftDesc("");
    setMsg(`已创建项目「${title}」`);
    load();
    router.push(`/projects/${d.project.id}`);
  }

  async function rename(p: Project) {
    const title = editing?.title.trim() ?? "";
    if (!title) return;
    await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, title, description: editing?.description ?? p.description }),
    }).catch(() => null);
    setEditing(null);
    setMsg("已重命名（目录名不变）");
    load();
  }

  async function remove(p: Project) {
    const r = await fetch(`/api/projects?id=${p.id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) setErr("删除失败");
    else {
      setMsg(`已删除项目「${p.title}」及其文件`);
      load();
    }
    setConfirmDel(null);
  }

  const shown = projects.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={configured} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
          <button
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
            className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-neutral-700"
          >
            ＋ 新建项目
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目…"
            className="ml-auto w-64 rounded-lg border border-neutral-200 px-3 py-1.5 text-[13px] outline-none focus:border-neutral-400"
          />
        </div>

        {/* 新建/编辑表单 */}
        {(creating || editing) && (
          <div className="mx-6 mt-4 space-y-2 rounded-xl border border-neutral-200 p-4">
            <div className="text-sm font-medium">{editing ? "编辑项目" : "新建项目"}</div>
            <input
              value={editing ? editing.title : draftTitle}
              onChange={(e) =>
                editing ? setEditing({ ...editing, title: e.target.value }) : setDraftTitle(e.target.value)
              }
              placeholder="项目名称（如：高数 / 期末复习 / 做 PPT）"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <input
              value={editing ? editing.description ?? "" : draftDesc}
              onChange={(e) =>
                editing ? setEditing({ ...editing, description: e.target.value }) : setDraftDesc(e.target.value)
              }
              placeholder="简介（可选）"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <div className="flex gap-2">
              <button
                onClick={() => (editing ? rename(editing) : create())}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {err && <p className="mx-6 mt-3 text-xs text-red-600">{err}</p>}
        {msg && <p className="mx-6 mt-3 text-xs text-emerald-700">{msg}</p>}

        {/* 项目卡片网格 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5">
            {shown.map((p) => (
              <div key={p.id} className="group relative">
                <Link
                  href={`/projects/${p.id}`}
                  className="block rounded-xl border border-neutral-200 p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                >
                  <div
                    className={`flex h-28 w-full items-center justify-center rounded-lg text-3xl font-semibold ${projectTileClasses(p.id)}`}
                  >
                    {projectInitial(p.title)}
                  </div>
                  <div className="mt-3 truncate text-[14px] font-medium text-neutral-800">{p.title}</div>
                  <div className="mt-0.5 text-[11px] text-neutral-400">
                    {p.sourceCount} 份资料 · {p.artifactCount} 份产物
                  </div>
                  <div className="text-[11px] text-neutral-300">
                    {new Date(p.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </Link>
                {/* 行操作（悬停）：编辑 / 删除（二次确认） */}
                <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <button
                    onClick={() => {
                      setCreating(false);
                      setEditing(p);
                    }}
                    title="编辑"
                    className="rounded-md bg-white/90 px-2 py-1 text-[11px] text-neutral-600 shadow-sm hover:bg-white"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => (confirmDel === p.id ? remove(p) : setConfirmDel(p.id))}
                    title="删除项目（含全部文件，不可逆）"
                    className={`rounded-md px-2 py-1 text-[11px] shadow-sm ${
                      confirmDel === p.id
                        ? "bg-red-600 text-white"
                        : "bg-white/90 text-neutral-600 hover:bg-white hover:text-red-600"
                    }`}
                  >
                    {confirmDel === p.id ? "确认删除？" : "🗑"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {shown.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm text-neutral-400">
                {query ? "无匹配项目" : "还没有项目：点「新建项目」开始（一门课、一次任务都可以）"}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
