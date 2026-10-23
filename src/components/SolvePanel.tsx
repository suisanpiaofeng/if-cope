"use client";

/** 解题答疑面板：输入问题（可附题目照片）→ 生成非线性解答图（可跳转引用、可存档下载） */
import { useRef, useState } from "react";
import QACanvas from "./notes/QACanvas";
import type { QaCite, QaCanvasData } from "@/lib/qaCanvas";

export default function SolvePanel({
  contextSourceIds,
  onCite,
  onSaved,
}: {
  /** 当前勾选的资料（作为解答依据；为空=纯通用知识解答） */
  contextSourceIds: number[];
  onCite?: (c: QaCite) => void;
  onSaved?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canvas, setCanvas] = useState<QaCanvasData | null>(null);
  const [savedMsg, setSavedMsg] = useState("");
  const [model, setModel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
    setSavedMsg("");
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          sourceIds: contextSourceIds,
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
      setModel(d.model ?? "");
      setSavedMsg(`解答图已存入 AIGC（产物 #${d.artifactId}），可在左侧文件树重开或下载`);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadJson() {
    if (!canvas) return;
    const blob = new Blob([JSON.stringify(canvas, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(canvas.title || "解答图").replace(/[\\/:*?"<>|]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-4">
      {/* 输入区 */}
      <div className="border border-neutral-200 p-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="输入题目或问题，例如：这道积分题怎么做？（可附题目照片）"
          rows={3}
          className="w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
          >
            📷 附题目照片
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
          {image && (
            <span className="flex items-center gap-1.5 border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt="" className="h-6 w-6 object-cover" />
              <span className="max-w-[140px] truncate">{image.name}</span>
              <button onClick={() => setImage(null)} className="text-neutral-400 hover:text-red-600">×</button>
            </span>
          )}
          <span className="num ml-auto text-[11px] text-neutral-400">
            依据：{contextSourceIds.length > 0 ? `已勾选的 ${contextSourceIds.length} 份资料` : "通用知识（未勾选资料）"}
          </span>
          <button
            onClick={solve}
            disabled={busy || (!question.trim() && !image)}
            className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {busy ? "解答中…" : "生成解答图"}
          </button>
        </div>
        {error && (
          <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {savedMsg && (
          <div className="mt-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {savedMsg}
            {model && <span className="num ml-2 text-emerald-600/70">{model}</span>}
          </div>
        )}
      </div>

      {/* 画布区 */}
      <div className="mt-4">
        {canvas ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{canvas.title}</div>
              <div className="flex gap-2">
                <button onClick={() => setQuestion("")} className="border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">
                  再解一题
                </button>
                <button onClick={downloadJson} className="border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">
                  下载 JSON
                </button>
              </div>
            </div>
            <QACanvas content={canvas} onCite={onCite} />
            <div className="mt-2 text-[11px] text-neutral-400">
              拖动可移动节点 · 滚轮缩放 · 点节点上的 📎 引用跳到资料原文
            </div>
          </>
        ) : (
          <div className="border border-dashed border-neutral-200 px-6 py-14 text-center text-sm text-neutral-400">
            {busy ? "正在生成解答图…" : "生成后的解答图会显示在这里：解题思路、推导步骤、知识点、易错点与结论一目了然"}
          </div>
        )}
      </div>
    </div>
  );
}
