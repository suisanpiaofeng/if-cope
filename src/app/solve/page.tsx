"use client";

/**
 * 解题答疑（一级功能页）：提问（可附题目照片）→ 非线性解答图（引用可跳转原文）。
 * 左栏：提问 / 依据资料选择 / 历史解答；主区：大画布 + 工具条。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import QACanvas from "@/components/notes/QACanvas";
import { qaCanvasToMarkdown, type QaCanvasData, type QaCite } from "@/lib/qaCanvasTypes";
import type { Source } from "@/lib/types";

type HistoryItem = { id: number; title: string; created_at: number };

export default function SolvePage() {
  // ── 提问 ──
  const [question, setQuestion] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 依据资料（勾选；空 = 通用知识）──
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const ready = useMemo(() => sources.filter((s) => s.status === "ready"), [sources]);

  // ── 画布 + 历史 ──
  const [canvas, setCanvas] = useState<QaCanvasData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []));
    loadHistory();
  }, []);

  function loadHistory() {
    fetch("/api/artifacts?categoryId=all")
      .then((r) => r.json())
      .then((d) =>
        setHistory((d.artifacts ?? []).filter((a: { type: string }) => a.type === "qa-canvas"))
      );
  }

  function togglePick(id: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function pickImage(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("请选择图片文件（拍题照片等）");
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      setImage({ dataUrl: String(r.result), name: f.name });
      setError("");
    };
    r.readAsDataURL(f);
  }

  async function solve() {
    if (busy || (!question.trim() && !image)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          sourceIds: [...picked],
          image: image?.dataUrl ?? null,
        }),
      });
      const d = (await res.json()) as {
        error?: string;
        artifactId?: number;
        canvas?: QaCanvasData;
        model?: string;
      };
      if (!res.ok || !d.canvas) throw new Error(d.error || "解答失败");
      setCanvas(d.canvas);
      setNotice(`已存入 AIGC（产物 #${d.artifactId}）· ${d.model ?? ""}`);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(id: number) {
    const res = await fetch(`/api/artifacts/${id}`);
    if (!res.ok) return;
    const d = (await res.json()) as { content?: string };
    try {
      setCanvas(JSON.parse(d.content ?? "") as QaCanvasData);
      setNotice("");
      setError("");
    } catch {
      setError("历史解答图数据损坏");
    }
  }

  function download(kind: "json" | "md") {
    if (!canvas) return;
    const isJson = kind === "json";
    const body = isJson ? JSON.stringify(canvas, null, 2) : qaCanvasToMarkdown(canvas);
    const blob = new Blob([body], {
      type: isJson ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(canvas.title || "解答图").replace(/[\\/:*?"<>|]/g, "_")}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 引用跳转：新标签打开工作台并定位到源（深链） */
  function onCite(c: QaCite) {
    window.open(`/?openSource=${c.sourceId}`, "_blank");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 左栏：提问 + 依据资料 + 历史 */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">解题答疑</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">提问 → 解答图 · 引用可跳转原文</div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入题目或问题，例如：这道积分题怎么做？"
            rows={4}
            className="w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
            >
              📷 题目照片
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
            {image && (
              <span className="flex items-center gap-1 border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt="" className="h-5 w-5 object-cover" />
                <span className="max-w-[100px] truncate">{image.name}</span>
                <button onClick={() => setImage(null)} className="text-neutral-400 hover:text-red-600">×</button>
              </span>
            )}
            <button
              onClick={solve}
              disabled={busy || (!question.trim() && !image)}
              className="ml-auto border border-neutral-900 bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {busy ? "解答中…" : "生成解答图"}
            </button>
          </div>
          {error && (
            <div className="mt-2 border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>
          )}
          {notice && (
            <div className="mt-2 border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
              {notice}
            </div>
          )}

          {/* 依据资料 */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                依据资料 <span className="num">{picked.size > 0 ? `已选 ${picked.size}` : "通用知识"}</span>
              </span>
              <div className="flex gap-1 text-[11px]">
                <button
                  onClick={() => setPicked(new Set(ready.map((s) => s.id)))}
                  className="text-neutral-400 hover:text-neutral-900"
                >
                  全选
                </button>
                <button onClick={() => setPicked(new Set())} className="text-neutral-400 hover:text-neutral-900">
                  清空
                </button>
              </div>
            </div>
            <div className="mt-1 max-h-[180px] overflow-y-auto border border-neutral-100">
              {ready.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-neutral-300">暂无可用资料（先去工作台上传）</p>
              ) : (
                ready.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-neutral-50 ${
                      picked.has(s.id) ? "bg-neutral-100" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={() => togglePick(s.id)}
                      className="accent-neutral-900"
                    />
                    <span className="truncate text-neutral-700">{s.title}</span>
                  </label>
                ))
              )}
            </div>
            <p className="mt-1 text-[10px] text-neutral-400">
              不勾选 = 按通用知识解答；勾选后解答会标注资料出处（📎 可跳转原文）
            </p>
          </div>

          {/* 历史解答 */}
          <div className="mt-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              历史解答 <span className="num">{history.length}</span>
            </div>
            <div className="mt-1">
              {history.length === 0 ? (
                <p className="px-1 py-1 text-[11px] text-neutral-300">暂无，生成的解答图会保存在这里</p>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => void openHistory(h.id)}
                    className="block w-full truncate px-1 py-1 text-left text-[11px] text-neutral-600 hover:text-neutral-900"
                    title={h.title}
                  >
                    🧩 {h.title}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 主区：大画布 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-2.5">
          <div className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {canvas ? canvas.title : "解答图画布"}
          </div>
          {canvas && (
            <>
              <button onClick={() => download("md")} className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
                下载 MD
              </button>
              <button onClick={() => download("json")} className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">
                下载 JSON
              </button>
            </>
          )}
          <Link href="/" className="border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
            去工作台
          </Link>
        </div>
        <div className="min-h-0 flex-1 p-4">
          {canvas ? (
            <QACanvas content={canvas} onCite={onCite} className="h-full w-full border border-neutral-200" />
          ) : (
            <div className="flex h-full items-center justify-center border border-dashed border-neutral-200">
              <div className="max-w-[420px] text-center">
                <div className="text-4xl">🧩</div>
                <p className="mt-3 text-sm text-neutral-400">
                  在左侧输入题目或问题，生成的解答图会显示在这里：
                  <br />
                  解题思路 · 推导步骤 · 知识点 · 易错点 · 结论，一图看清
                </p>
                <p className="mt-2 text-[11px] text-neutral-300">拖动移动节点 · 滚轮缩放 · 📎 引用跳转资料原文</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
