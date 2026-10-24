"use client";

/** 图片改尺寸：按像素/百分比缩放，保持比例，canvas 输出对比下载 */
import { useRef, useState } from "react";
import { Actions, Btn, NumInput, Select } from "./_ui";

type Src = { url: string; w: number; h: number; size: number; name: string };

export default function ImageResize() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<Src | null>(null);
  const [mode, setMode] = useState<"px" | "pct">("px");
  const [w, setW] = useState(800);
  const [h, setH] = useState(600);
  const [keep, setKeep] = useState(true);
  const [fmt, setFmt] = useState<"image/png" | "image/jpeg" | "image/webp">("image/png");
  const [outUrl, setOutUrl] = useState("");
  const [outSize, setOutSize] = useState(0);
  const [error, setError] = useState("");

  async function onPick(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    setError("");
    if (outUrl) { URL.revokeObjectURL(outUrl); setOutUrl(""); }
    if (src) URL.revokeObjectURL(src.url); // 释放旧图
    const url = URL.createObjectURL(f);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = () => rej(new Error("读取失败")); img.src = url; });
    setSrc({ url, w: img.naturalWidth, h: img.naturalHeight, size: f.size, name: f.name });
    setW(img.naturalWidth); setH(img.naturalHeight);
  }

  function setWKeep(v: number) {
    setW(v);
    if (keep && src) setH(Math.max(1, Math.round(v * (src.h / src.w))));
  }
  function setHKeep(v: number) {
    setH(v);
    if (keep && src) setW(Math.max(1, Math.round(v * (src.w / src.h))));
  }

  async function resize() {
    if (!src) return;
    setError("");
    try {
      const finalW = mode === "pct" ? Math.max(1, Math.round((src.w * w) / 100)) : w;
      const finalH = mode === "pct" ? Math.max(1, Math.round((src.h * h) / 100)) : h;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = () => rej(new Error("读取失败")); img.src = src.url; });
      const canvas = document.createElement("canvas");
      canvas.width = finalW; canvas.height = finalH;
      canvas.getContext("2d")!.drawImage(img, 0, 0, finalW, finalH);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, fmt, fmt === "image/png" ? undefined : 0.92));
      if (!blob) throw new Error("导出失败");
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const effW = mode === "pct" && src ? Math.round((src.w * w) / 100) : w;
  const effH = mode === "pct" && src ? Math.round((src.h * h) / 100) : h;
  const ext = fmt === "image/png" ? "png" : fmt === "image/webp" ? "webp" : "jpg";

  return (
    <div className="max-w-[720px]">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
        className="cursor-pointer border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 hover:border-neutral-500">
        点击选择图片，或拖进来（本地处理，不上传）
      </div>

      {src && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src.url} alt="原图" className="h-28 border border-neutral-200 object-contain" />
            <div className="text-xs text-neutral-600">
              原尺寸 <span className="num">{src.w}×{src.h}</span> · <span className="num">{(src.size / 1024).toFixed(1)} KB</span>
              <div className="mt-1 text-neutral-400">→ 目标 <span className="num">{effW}×{effH}</span></div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Select label="单位" value={mode} onChange={setMode}
              options={[{ value: "px", label: "像素" }, { value: "pct", label: "百分比" }]} />
            <span>宽</span><NumInput value={w} onChange={setWKeep} min={1} className="w-24" />
            <span>高</span><NumInput value={h} onChange={setHKeep} min={1} className="w-24" />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={keep} onChange={() => setKeep((v) => !v)} /> 锁定比例
            </label>
            <Select label="格式" value={fmt} onChange={setFmt}
              options={[{ value: "image/png", label: "PNG" }, { value: "image/jpeg", label: "JPEG" }, { value: "image/webp", label: "WebP" }]} />
          </div>

          <Actions>
            <Btn onClick={() => { setW(src.w); setH(src.h); }}>还原</Btn>
            <button onClick={resize}
              className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700">改尺寸</button>
            {outUrl && (
              <a href={outUrl} download={src.name.replace(/\.\w+$/, "") + "-resized." + ext}
                className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">
                下载（<span className="num">{(outSize / 1024).toFixed(1)} KB</span>）
              </a>
            )}
          </Actions>
          {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>
      )}
    </div>
  );
}
