"use client";

/** 项目视图（OpenFic 对齐定稿 §3.4）：项目=自由工作空间。
 *  三栏：文件树 | 预览编辑 | 工作对话（WorkspaceView）；进入项目自动入最近槽位。 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import WorkspaceView from "@/components/WorkspaceView";
import { pushRecent } from "@/lib/recentProjects";

type Project = { id: number; title: string; description: string | null; dir: string; sourceCount: number; artifactCount: number };

export default function ProjectViewPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setConfigured(d.hasKey && Boolean(d.baseUrl && d.chatModel)))
      .catch(() => setConfigured(null));
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: { projects?: Project[] }) => {
        const p = (d.projects ?? []).find((x) => x.id === id);
        if (p) {
          setProject(p);
          pushRecent({ id: p.id, title: p.title, dir: p.dir });
        } else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={configured} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 项目头 */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-5 py-2.5">
          <Link href="/projects" className="text-xs text-neutral-400 hover:text-neutral-700">
            ← 项目
          </Link>
          <h1 className="truncate text-[15px] font-semibold text-neutral-800">{project?.title ?? (notFound ? "项目不存在" : "…")}</h1>
          {project?.description && <span className="truncate text-xs text-neutral-400">{project.description}</span>}
          {project && (
            <span className="ml-auto shrink-0 text-[11px] text-neutral-400">
              {project.sourceCount} 份资料 · {project.artifactCount} 份产物
            </span>
          )}
        </div>
        {/* 三栏工作区 */}
        <WorkspaceView projectId={Number.isFinite(id) ? id : undefined} projectDir={project?.dir} />
      </div>
    </div>
  );
}
