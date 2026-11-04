"use client";

/**
 * 文献翻译（一级功能页）：
 * 左栏资源框只列可翻译文件（已解析、有文本），自动高亮疑似英文文献；
 * 多选 → 批量翻译（SSE 逐批进度）→ 右侧双文对照（原文/译文逐段对齐）；
 * 每个文件一个标签可并存；产物下载 HTML（双栏可打印）/ Markdown。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import FilesPanel from "@/components/FilesPanel";
import type { AnyTranslationDoc, Source, TranslationDoc } from "@/lib/types";
import { isPdfDoc } from "@/lib/types";
import { useLibrary } from "@/lib/useLibrary";

type TrTab = {
  key: string;
  artifactId: number | null;
  sourceId: number | null;
  title: string;
  status: "translating" | "done" | "error";
  progress: { done: number; total: number };
  doc: AnyTranslationDoc | null;
  /** PDF 保真通道（pdf2zh，双 PDF 预览） */
  pdfMode?: boolean;
  error?: string;
};

let tabSeq = 1;

/** 疑似英文文献：标题里拉丁字母占比高（翻译功能的主攻对象，高亮提示） */
function looksEnglish(s: Source): boolean {
  const latin = (s.title.match(/[a-zA-Z]/g) ?? []).length;
  return latin >= 4 && latin / Math.max(s.title.length, 1) > 0.35;
}

export default function TranslatePage() {
  // 共享资源库：视图过滤 = 仅 PDF（本功能只做保真双语翻译）；勾选集即翻译选集
  const lib = useLibrary({
    sourceFilter: (s) => s.source_type === "file" && s.ext.toLowerCase() === "pdf",
  });
  const { sources, categories, selected: picked } = lib;
  const [tabs, setTabs] = useState<TrTab[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  const active = tabs.find((t) => t.key === activeKey) ?? null;

  /** 翻译历史 = 产物里 type=translation（共享 hook 已拉全量产物，无需另拉） */
  const history = useMemo(
    () => lib.artifacts.filter((a) => a.type === "translation"),
    [lib.artifacts]
  );

  /** 可翻译：仅 PDF（文件可用性由服务端校验） */
  const translatable = useMemo(
    () => sources.filter((s) => s.source_type === "file" && s.ext.toLowerCase() === "pdf"),
    [sources]
  );
  const englishPicks = translatable.filter(looksEnglish);

  function patchTab(key: string, partial: Partial<TrTab>) {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...partial } : t)));
  }

  const runOne = useCallback(
    async (s: Source) => {
      const key = `t${Date.now().toString(36)}${tabSeq++}`;
      setTabs((prev) => [
        ...prev,
        { key, artifactId: null, sourceId: s.id, title: s.title, status: "translating", progress: { done: 0, total: 0 }, doc: null, pdfMode: true },
      ]);
      setActiveKey(key);
      try {
        // PDF → pdf2zh 保真翻译（保留原版排版，产出双语/译文两份 PDF）
        const res = await fetch("/api/translatePdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: s.id }),
        });
        const d = (await res.json()) as { error?: string; artifactId?: number; doc?: AnyTranslationDoc };
        if (!res.ok || !d.doc || d.artifactId == null) throw new Error(d.error || `HTTP ${res.status}`);
        patchTab(key, { status: "done", artifactId: d.artifactId, doc: d.doc });
        void lib.load();
      } catch (e) {
        patchTab(key, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    [lib.load] // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function startBatch() {
    if (batchBusy || busyRef.current || picked.size === 0) return;
    setBatchBusy(true);
    busyRef.current = true;
    setError("");
    try {
      for (const id of picked) {
        const s = sources.find((x) => x.id === id);
        if (s) await runOne(s); // 串行：避免并发打爆翻译上游
      }
      lib.clearSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(false);
      busyRef.current = false;
    }
  }

  async function openHistory(id: number) {
    const exist = tabs.find((t) => t.artifactId === id);
    if (exist) {
      setActiveKey(exist.key);
      return;
    }
    const art = await fetch(`/api/artifacts/${id}`).then((r) => r.json());
    try {
      const doc = JSON.parse(art.content) as AnyTranslationDoc;
      const pdf = isPdfDoc(doc);
      const segN = pdf ? 0 : doc.segments.length;
      const key = `t${Date.now().toString(36)}${tabSeq++}`;
      setTabs((prev) => [
        ...prev,
        { key, artifactId: id, sourceId: doc.sourceId, title: doc.sourceTitle, status: "done", doc, pdfMode: pdf, progress: { done: segN, total: segN } },
      ]);
      setActiveKey(key);
    } catch {
      setError("翻译产物数据损坏");
    }
  }

  function closeTab(key: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      if (key === activeKey) setActiveKey(next[next.length - 1]?.key ?? "");
      return next;
    });
  }

  // ── 下载：双栏 HTML（可打印） / Markdown ──
  function download(doc: TranslationDoc, format: "html" | "md") {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let body: string;
    let mime: string;
    let ext: string;
    if (format === "html") {
      const rows = doc.segments
        .map(
          (s, i) =>
            `<tr>${i > 0 && s.page !== null && doc.segments[i - 1].page !== s.page ? `<tr class="pagebreak"><td colspan="2">── 第 ${s.page} 页 ──</td></tr>` : ""}<td class="src">${s.heading ? `<b>${esc(s.heading)}</b><br>` : ""}${esc(s.src)}</td><td class="trg">${esc(s.trg)}</td></tr>`
        )
        .join("\n");
      body = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(doc.sourceTitle)} · 双语对照</title><style>
body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#222}h1{font-size:18px}
.meta{color:#888;font-size:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
td{border:1px solid #ddd;padding:10px 12px;vertical-align:top;line-height:1.8;width:50%}
td.src{background:#fafafa}td.trg{background:#fff}
tr.pagebreak td{border:none;text-align:center;color:#999;padding:6px}
@page{size:A4 landscape;margin:14mm}
</style></head><body><h1>${esc(doc.sourceTitle)} · 中文翻译（双语对照）</h1>
<div class="meta">由 IF.Cope 文献翻译生成 · 模型 ${esc(doc.model)} · ${new Date(doc.translatedAt).toLocaleString("zh-CN")}${doc.truncated ? " · 文档超长已截断" : ""}</div>
<table>${rows}</table></body></html>`;
      mime = "text/html;charset=utf-8";
      ext = "html";
    } else {
      const parts = [`# ${doc.sourceTitle} · 中文翻译`, "", `> 模型 ${doc.model} · ${new Date(doc.translatedAt).toLocaleString("zh-CN")}`, ""];
      for (const s of doc.segments) {
        if (s.page != null) parts.push(`---`, `**第 ${s.page} 页${s.heading ? ` · ${s.heading}` : ""}**`, "");
        parts.push("<details><summary>原文</summary>", "", s.src, "", "</details>", "", s.trg, "");
      }
      body = parts.join("\n");
      mime = "text/markdown;charset=utf-8";
      ext = "md";
    }
    const blob = new Blob([body], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.sourceTitle || "翻译").replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 左栏：共享资源栏（视图 = 仅 PDF）+ 翻译历史 */}
      <div className="flex w-[280px] shrink-0 flex-col">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">文献翻译</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">多选 → 批量翻译 · 双文对照 · 可下载</div>
        </div>
        {error && (
          <div className="mx-3 mt-2 border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>
        )}
        <div className="min-h-0 flex-1">
          <FilesPanel
            sources={translatable}
            artifacts={[]}
            categories={categories}
            genError={null}
            selected={picked}
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
            onOpenSource={(s) => lib.toggleSelect(s.id)}
            onOpenArtifact={() => {}}
            sectionTitle="待翻译资源"
            emptyText="暂无可翻译资源（先上传 PDF 并等待解析完成）"
            sourceMeta={(s) => `PDF · ${s.chunk_count > 0 ? `${s.chunk_count} 段 · ` : ""}${new Date(s.created_at).toLocaleDateString("zh-CN")}`}
            sourceRowClass={(s) => (looksEnglish(s) ? "border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent")}
            sourceBadge={(s) =>
              looksEnglish(s) ? (
                <span className="shrink-0 text-[10px]" title="疑似英文文献">🌐</span>
              ) : null
            }
            topBarExtra={
              <>
                <button
                  onClick={() => lib.selectOnly(englishPicks.map((s) => s.id))}
                  className="text-[11px] text-neutral-400 hover:text-neutral-900"
                  title="只选中疑似英文文献"
                >
                  选英文文献
                </button>
                <button
                  onClick={lib.clearSelection}
                  className="text-[11px] text-neutral-400 hover:text-neutral-900"
                >
                  清空
                </button>
              </>
            }
            bottomSlot={
              <div className="border-t border-neutral-200 px-3 py-3">
                <button
                  onClick={startBatch}
                  disabled={batchBusy || picked.size === 0}
                  className="w-full border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  {batchBusy ? "批量翻译中…" : picked.size > 0 ? `翻译选中的 ${picked.size} 份` : "勾选资源开始翻译"}
                </button>

                <div className="mt-4 max-h-[240px] overflow-y-auto">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                    历史翻译 <span className="num">{history.length}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {history.length === 0 ? (
                      <p className="px-1 py-1 text-[11px] text-neutral-300">暂无</p>
                    ) : (
                      history.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => void openHistory(h.id)}
                          className="block w-full truncate px-2 py-1.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                          title={h.title}
                        >
                          📖 {h.title}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>

      {/* 主区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 翻译标签栏 */}
        <div className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-50/60 px-2 pt-1.5">
          {tabs.map((t) => (
            <div
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className={`group flex max-w-[190px] cursor-pointer items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 text-[11px] ${
                t.key === activeKey
                  ? "border-neutral-200 bg-white font-medium text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              <span className="shrink-0">{t.status === "translating" ? "⏳" : t.status === "error" ? "❌" : "📖"}</span>
              <span className="truncate">{t.title}</span>
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
          {tabs.length === 0 && <span className="px-3 py-2 text-[11px] text-neutral-400">左侧勾选资源开始翻译，或打开历史翻译</span>}
        </div>

        {/* 内容 */}
        {!active ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-[420px] text-center">
              <div className="text-4xl">📖</div>
              <p className="mt-3 text-sm text-neutral-400">
                在左侧勾选要翻译的资料（🌐 标记为疑似英文文献，可一键选中），
                <br />
                支持 PDF 保真翻译，译文自动进入左侧资源目录（可预览/检索），完成后在此对照阅读，可下载译文 PDF
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 工具条 */}
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2">
              <div className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {active.doc ? active.doc.sourceTitle : active.title}
              </div>
              {active.doc && (
                <>
                  {isPdfDoc(active.doc) ? (
                    <>
                      <span className="num shrink-0 text-[10px] text-neutral-400">
                        PDF 保留排版 · {active.doc.model}
                      </span>
                      {active.doc.monoPdf && (
                        <a
                          href={`/api/translations/${active.artifactId}?which=mono&download=1`}
                          className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
                        >
                          下载译文 PDF
                        </a>
                      )}
                      <a
                        href={`/api/translations/${active.artifactId}?which=dual&download=1`}
                        className="shrink-0 border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-xs text-white hover:bg-neutral-700"
                      >
                        下载双语 PDF
                      </a>
                    </>
                  ) : (
                    <>
                      <span className="num shrink-0 text-[10px] text-neutral-400">
                        {active.doc.segments.length} 段 · {active.doc.model}
                        {active.doc.truncated ? " · 已截断" : ""}
                      </span>
                      <button onClick={() => download(active.doc as TranslationDoc, "md")} className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
                        下载 MD
                      </button>
                      <button onClick={() => download(active.doc as TranslationDoc, "html")} className="shrink-0 border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-xs text-white hover:bg-neutral-700">
                        下载双语 HTML
                      </button>
                    </>
                  )}
                </>
              )}
              <Link href="/" className="shrink-0 border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
                工作台
              </Link>
            </div>

            {/* 进度 / 错误 */}
            {active.status === "translating" && active.pdfMode && (
              <div className="px-6 py-3">
                <div className="mb-1.5 text-[11px] text-neutral-500">
                  ⏳ PDF 保真翻译中（保留原版排版，通常 1-3 分钟）…
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-neutral-900" />
                </div>
              </div>
            )}
            {active.status === "translating" && !active.pdfMode && (
              <div className="px-6 py-3">
                <div className="mb-1 flex justify-between text-[11px] text-neutral-500">
                  <span>翻译中…（{active.progress.done}/{active.progress.total || "?"} 段）</span>
                  <span className="num">{active.progress.total ? Math.round((active.progress.done / active.progress.total) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full bg-neutral-900 transition-all duration-300"
                    style={{ width: `${active.progress.total ? (active.progress.done / active.progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
            {active.status === "error" && (
              <div className="m-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                翻译失败：{active.error}
              </div>
            )}

            {/* 对照：PDF 保真版（双 PDF）/ 文本双栏 */}
            {active.doc && isPdfDoc(active.doc) ? (
              <PdfCompare
                sourceId={active.sourceId ?? active.doc.sourceId}
                artifactId={active.artifactId ?? 0}
                mono={active.doc.monoPdf != null || active.doc.translatedSourceId != null}
              />
            ) : active.doc ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[1160px] px-4 py-4">
                  <div className="sticky top-0 z-10 grid grid-cols-2 border border-neutral-300 bg-neutral-100 text-[11px] font-medium text-neutral-600">
                    <div className="border-r border-neutral-300 px-3 py-1.5">原文</div>
                    <div className="px-3 py-1.5">中文译文</div>
                  </div>
                  {(active.doc as TranslationDoc).segments.map((seg, i) => {
                    const doc = active.doc as TranslationDoc;
                    const newPage =
                      i > 0 && seg.page !== null && doc.segments[i - 1].page !== seg.page;
                    return (
                      <div key={i}>
                        {newPage && (
                          <div className="num border-x border-b border-neutral-200 bg-neutral-50 py-1 text-center text-[10px] text-neutral-400">
                            ── 第 {seg.page} 页 ──
                          </div>
                        )}
                        <div className="grid grid-cols-2 border-x border-b border-neutral-200">
                          <div className="border-r border-neutral-200 bg-neutral-50/60 px-3 py-2.5 text-[12px] leading-6 whitespace-pre-wrap text-neutral-700">
                            {seg.heading && <div className="mb-1 text-[11px] font-semibold text-neutral-500">{seg.heading}</div>}
                            {seg.src}
                          </div>
                          <div className="px-3 py-2.5 text-[12px] leading-6 whitespace-pre-wrap text-neutral-900">
                            {seg.trg}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="py-6 text-center text-[11px] text-neutral-400">— 翻译结束 —</div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

/** PDF 对照：左原版 PDF、右纯译文 PDF（页数与原版一致，逐页对照阅读）；
 *    无译文版时回退双语版（原译交替，页数会多于原版） */
function PdfCompare({ sourceId, artifactId, mono }: { sourceId: number; artifactId: number; mono: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
      <div className="mb-2 flex items-center gap-3 text-[11px] text-neutral-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-400" />原文（原版排版）</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />{mono ? "中文译文（纯译文版，与左页逐页对照）" : "中文双语对照（原译交替）"}</span>
        <span className="ml-auto text-neutral-400">两页均为完整 PDF，可各自滚动/缩放对照阅读</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        {/* iframe 必须显式 h-full：UA 默认 height:150px 会阻断 grid 拉伸，
            极端扁视口会让 PDFium 算出分数缩放把文字栅格切碎（显示错乱的根因） */}
        <iframe src={`/api/preview/${sourceId}`} title="原文 PDF" className="h-full min-h-0 w-full border border-neutral-300" />
        <iframe src={`/api/translations/${artifactId}?which=${mono ? "mono" : "dual"}`} title="译文 PDF" className="h-full min-h-0 w-full border border-neutral-300" />
      </div>
    </div>
  );
}
