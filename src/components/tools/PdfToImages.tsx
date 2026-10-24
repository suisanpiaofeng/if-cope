"use client";

/** PDF 转图片：pdfjs 逐页渲染 PNG/JPEG（客户端 canvas，worker 走 public/） */
import { useRef, useState } from "react";
import { Btn, Hint, NumInput, Select } from "./_ui";

type Rendered = { page: number; url: string; w: number; h: number };

export default function PdfToImages() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Rendered[]>([]);
  const [name, setName] = useState("");
  const [scale, setScale] = useState(2);
  const [fmt, setFmt] = useState<"image/png" | "image/jpeg">("image/png");
  const [quality, setQuality] = useState(0.92);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");

  async function onPick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setError(""); setProg(""); pages.forEach((p) => URL.revokeObjectURL(p.url)); setPages([]);
    setName(f.name);
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      const out: Rendered[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        setProg(`渲染第 ${i}/${doc.numPages} 页…`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise;
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, fmt, fmt === "image/jpeg" ? quality : undefined));
        if (blob) out.push({ page: i, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height });
        page.cleanup();
      }
      setPages(out);
    } catch (e) {
      setError(`渲染失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false); setProg("");
    }
  }

  function downloadAll() {
    pages.forEach((p, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = p.url;
        a.download = `${name.replace(/\.pdf$/i, "")}-p${p.page}.${fmt === "image/png" ? "png" : "jpg"}`;
        a.click();
      }, i * 200);
    });
  }

  const ext = fmt === "image/png" ? "png" : "jpg";

  return (
    <div className="max-w-[860px]">
      <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <Btn onClick={() => fileRef.current?.click()}>选择 PDF</Btn>
        <Select label="格式" value={fmt} onChange={setFmt}
          options={[{ value: "image/png", label: "PNG" }, { value: "image/jpeg", label: "JPEG" }]} />
        <span>清晰度</span>
        <NumInput value={scale} onChange={setScale} min={0.5} max={4} step={0.5} className="w-20" />
        {fmt === "image/jpeg" && (
          <label className="flex items-center gap-1">质量
            <input type="range" min={0.3} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            <span className="num">{Math.round(quality * 100)}%</span>
          </label>
        )}
        {pages.length > 0 && (
          <button onClick={downloadAll}
            className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">
            下载全部 {pages.length} 张
          </button>
        )}
      </div>

      <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
        className={`cursor-pointer border border-dashed px-6 py-8 text-center text-sm hover:border-neutral-500 ${
          pages.length ? "hidden" : "border-neutral-300 text-neutral-500"}`}>
        点击选择 PDF，或拖进来（客户端渲染，不上传）
      </div>

      {busy && <div className="border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{prog || "加载中…"}</div>}
      {error && <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {pages.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {pages.map((p) => (
            <div key={p.page} className="border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`第${p.page}页`} className="w-full" />
              <div className="flex items-center justify-between border-t border-neutral-100 px-2 py-1 text-[11px] text-neutral-500">
                <span>第 {p.page} 页 · <span className="num">{p.w}×{p.h}</span></span>
                <a href={p.url} download={`${name.replace(/\.pdf$/i, "")}-p${p.page}.${ext}`} className="hover:text-neutral-900">下载</a>
              </div>
            </div>
          ))}
        </div>
      )}
      <Hint text="清晰度=渲染缩放倍数（2 即 144 DPI）。页数多时建议降低清晰度，避免内存占用过高。" />
    </div>
  );
}
