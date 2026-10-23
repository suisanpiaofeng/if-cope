"use client";

/** 图片压缩：canvas 重绘 → 选格式/质量 → 对比体积 → 下载（全程本地） */
import { useRef, useState } from "react";

type Result = { url: string; size: number; name: string; type: string };

export default function ImageCompress() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<{ url: string; size: number; name: string } | null>(null);
  const [quality, setQuality] = useState(0.8);
  const [format, setFormat] = useState<"image/jpeg" | "image/webp" | "image/png">("image/jpeg");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function onPick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setError("");
    setResult(null);
    setSrc({ url: URL.createObjectURL(file), size: file.size, name: file.name });
  }

  async function compress() {
    if (!src) return;
    setBusy(true);
    setError("");
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("图片读取失败"));
        img.src = src.url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, format, format === "image/png" ? undefined : quality)
      );
      if (!blob) throw new Error("压缩失败");
      const ext = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: src.name.replace(/\.\w+$/, "") + "-compressed." + ext,
        type: format,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const ratio = src && result ? Math.round((1 - result.size / src.size) * 100) : 0;

  return (
    <div className="max-w-[720px]">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
        className="cursor-pointer border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 hover:border-neutral-500"
      >
        点击选择图片，或把图片拖进来（全程本地处理，不上传）
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />

      {src && (
        <div className="mt-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src.url} alt="原图" className="h-[140px] border border-neutral-200 object-contain" />
            <div className="flex-1 space-y-2">
              <div className="text-xs text-neutral-600">
                原图：<span className="num">{kb(src.size)}</span> · {src.name}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-500">输出格式</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs">
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/webp">WebP</option>
                  <option value="image/png">PNG（无损）</option>
                </select>
                <span className="text-neutral-500">质量</span>
                <input type="range" min={0.1} max={1} step={0.05} value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  disabled={format === "image/png"} />
                <span className="num w-9 text-neutral-700">{Math.round(quality * 100)}%</span>
              </div>
              <button onClick={compress} disabled={busy}
                className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40">
                {busy ? "压缩中…" : "压缩"}
              </button>
            </div>
          </div>

          {result && (
            <div className="mt-4 border border-neutral-200 p-3">
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.url} alt="压缩后" className="h-[140px] border border-neutral-200 object-contain" />
                <div className="flex-1">
                  <div className="text-xs text-neutral-600">
                    压缩后：<span className="num">{kb(result.size)}</span>
                    {ratio > 0 ? <span className="ml-2 text-emerald-600">↓ {ratio}%</span> : <span className="ml-2 text-amber-600">（反而变大了）</span>}
                  </div>
                  <a href={result.url} download={result.name}
                    className="mt-2 inline-block border border-neutral-300 px-4 py-1.5 text-xs hover:bg-neutral-50">
                    下载
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
