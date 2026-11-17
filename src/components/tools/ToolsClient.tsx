"use client";

/** 工具库（P5）：Stirling PDF 前端（iframe 嵌入本机 8080 服务）。
 *  服务由应用启动时自动拉起（vendor/Stirling-PDF.jar + Java17+）；
 *  PDF 工具处理完的文件下载后可拖入资料树入库。 */
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { isEditableExt } from "@/lib/preview";

type Project = { id: number; title: string; dir: string; sourceCount: number; artifactCount: number };

/** 支持直接拖入资料树的扩展名 */
function canIngest(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["pdf", "md", "txt", "docx"].includes(ext) || isEditableExt(ext);
}

export default function ToolsClient() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"checking" | "ready" | "starting" | "missing">("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setConfigured(d.hasKey && Boolean(d.baseUrl && d.chatModel)))
      .catch(() => setConfigured(null));
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: { projects?: Project[] }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
    // 探测 Stirling（首次可能需要 10~30s 启动，轮询）
    let alive = true;
    const probe = (n: number) => {
      if (!alive) return;
      fetch("/api/stirling/status")
        .then((r) => r.json())
        .then((d: { status: string }) => {
          if (!alive) return;
          setStatus(d.status as typeof status);
          if (d.status === "starting" && n < 20) setTimeout(() => probe(n + 1), 3000);
        })
        .catch(() => alive && setTimeout(() => probe(n + 1), 3000));
    };
    probe(0);
    return () => {
      alive = false;
    };
  }, []);

  /** Stirling 产物直接入库到所选项目（资料/<原文件名>） */
  async function ingestDownloaded(file: File) {
    if (!projectId) {
      setNotice("请先选择要入库的项目");
      return;
    }
    const project = projects.find((p) => p.id === projectId);
    if (!canIngest(file.name)) {
      setNotice(`「${file.name}」不是可入库类型（支持 pdf/md/txt/docx 及文本类）`);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("path", project?.dir ?? "资料");
    fd.append("type", "其他");
    const r = await fetch("/api/sources", { method: "POST", body: fd }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) setNotice(d?.error ?? "入库失败");
    else setNotice(`《${file.name}》已入库到「${project?.title}」`);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={configured} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：状态 + 入库目标 */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-5 py-2.5">
          <h1 className="text-[15px] font-semibold">PDF 工具库</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              status === "ready"
                ? "bg-emerald-50 text-emerald-700"
                : status === "missing"
                  ? "bg-neutral-100 text-neutral-400"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {status === "ready" ? "服务运行中" : status === "missing" ? "未安装" : "启动中…"}
          </span>
          <span className="ml-auto text-[11px] text-neutral-400">50+ PDF 工具 · 本地处理不上传外部服务</span>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none"
          >
            <option value="">处理结果入库到…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>

        {status === "missing" ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm text-neutral-500">未找到 Stirling PDF（vendor/Stirling-PDF.jar）</p>
            <p className="mt-1 text-xs text-neutral-400">下载 Release jar 放入 vendor/ 后重启应用即可（需 Java 17+）</p>
          </div>
        ) : status !== "ready" ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm text-neutral-500">Stirling PDF 启动中（首次约 10~30 秒）…</p>
            <div className="mt-3 h-1 w-40 overflow-hidden rounded bg-neutral-100">
              <div className="h-full w-1/2 animate-pulse rounded bg-neutral-400" />
            </div>
          </div>
        ) : (
          <>
            {notice && (
              <div className="mx-4 mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
                {notice}
              </div>
            )}
            {/* Stirling 前端：全量 50+ 工具（处理完的文件经浏览器下载 → 上面选好项目 → 拖到这里入库） */}
            <div
              className="min-h-0 flex-1"
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0];
                if (f) {
                  e.preventDefault();
                  void ingestDownloaded(f);
                }
              }}
            >
              <iframe src="http://127.0.0.1:8080" title="Stirling PDF" className="h-full min-h-0 w-full border-0" />
            </div>
            <p className="border-t border-neutral-100 px-4 py-1.5 text-[10px] text-neutral-400">
              处理完成的文件会经浏览器下载 → 把下载的文件拖到本区域即可入库到所选项目（支持 pdf/md/txt/docx）
            </p>
          </>
        )}
      </main>
    </div>
  );
}
