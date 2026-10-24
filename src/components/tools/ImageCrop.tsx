"use client";

/** 图片裁剪：拖拽框选区域，canvas 裁剪输出（本地不上传） */
import { useCallback, useEffect, useRef, useState } from "react";
import { Actions, Btn, NumInput } from "./_ui";

type Box = { x: number; y: number; w: number; h: number };

export default function ImageCrop() {
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string>("");
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<Box>({ x: 20, y: 20, w: 200, h: 150 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [error, setError] = useState("");
  const [outUrl, setOutUrl] = useState("");
  const [outSize, setOutSize] = useState(0);
  const drag = useRef<{ mode: string; sx: number; sy: number; orig: Box } | null>(null);

  const scale = disp.w && nat.w ? nat.w / disp.w : 1;

  async function onPick(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    setError("");
    if (outUrl) { URL.revokeObjectURL(outUrl); setOutUrl(""); }
    if (src) URL.revokeObjectURL(src); // 释放旧图
    const url = URL.createObjectURL(f);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = () => rej(new Error("读取失败")); img.src = url; });
    setSrc(url);
    setNat({ w: img.naturalWidth, h: img.naturalHeight });
    // 默认裁剪框：居中 60%
    const w = Math.round(img.naturalWidth * 0.6), h = Math.round(img.naturalHeight * 0.6);
    setBox({ x: Math.round((img.naturalWidth - w) / 2), y: Math.round((img.naturalHeight - h) / 2), w, h });
  }

  // 监听图片显示尺寸
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);

  const start = useCallback((mode: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, orig: { ...box } };
  }, [box]);

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !disp.w) return;
    const dx = Math.round((e.clientX - d.sx) * scale);
    const dy = Math.round((e.clientY - d.sy) * scale);
    let { x, y, w, h } = d.orig;
    if (d.mode === "move") {
      x = clamp(x + dx, 0, nat.w - w); y = clamp(y + dy, 0, nat.h - h);
    } else {
      if (d.mode.includes("e")) w = clamp(w + dx, 20, nat.w - x);
      if (d.mode.includes("s")) h = clamp(h + dy, 20, nat.h - y);
      if (d.mode.includes("w")) { const nx = clamp(x + dx, 0, x + w - 20); w = w + (x - nx); x = nx; }
      if (d.mode.includes("n")) { const ny = clamp(y + dy, 0, y + h - 20); h = h + (y - ny); y = ny; }
    }
    setBox({ x, y, w, h });
  }
  function onUp() { drag.current = null; }

  function crop() {
    if (!src || !nat.w) return;
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = box.w; canvas.height = box.h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
    }, "image/png");
  }

  // 显示坐标
  const d = disp.w && nat.w ? 1 / scale : 1;
  const db = { x: box.x * d, y: box.y * d, w: box.w * d, h: box.h * d };

  return (
    <div className="max-w-[860px]">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      {!src && (
        <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
          className="cursor-pointer border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 hover:border-neutral-500">
          点击选择图片，或拖进来（本地裁剪，不上传）
        </div>
      )}

      {src && (
        <div className="flex gap-4">
          <div ref={wrapRef} className="relative select-none" onPointerMove={onMove} onPointerUp={onUp}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={src} alt="原图" className="max-h-[440px] max-w-[520px] border border-neutral-200" draggable={false} />
            {disp.w > 0 && (
              <div className="absolute border-2 border-white bg-black/20"
                style={{ left: db.x, top: db.y, width: db.w, height: db.h, cursor: "move" }}
                onPointerDown={start("move")}>
                {["nw", "ne", "sw", "se"].map((m) => (
                  <div key={m} onPointerDown={start(m)}
                    className={`absolute h-3 w-3 border border-black bg-white ${m[0] === "n" ? "-top-1.5" : "-bottom-1.5"} ${m[1] === "w" ? "-left-1.5" : "-right-1.5"}`}
                    style={{ cursor: `${m}-resize` }} />
                ))}
              </div>
            )}
          </div>

          <div className="w-48 shrink-0 space-y-2 text-xs">
            <div className="text-neutral-500">原图 <span className="num">{nat.w}×{nat.h}</span></div>
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1 text-neutral-400">
                  {k.toUpperCase()}
                  <NumInput value={box[k]} min={0} className="w-16"
                    onChange={(v: number) => setBox((b) => ({ ...b, [k]: Math.max(0, v) }))} />
                </label>
              ))}
            </div>
            <Actions>
              <Btn onClick={() => setBox({ x: 0, y: 0, w: nat.w, h: nat.h })}>全选</Btn>
              <Btn onClick={() => fileRef.current?.click()}>换图</Btn>
            </Actions>
            <button onClick={crop}
              className="w-full border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700">裁剪</button>
            {outUrl && (
              <a href={outUrl} download="cropped.png"
                className="block border border-emerald-600 px-4 py-1.5 text-center text-xs text-emerald-700 hover:bg-emerald-50">
                下载（<span className="num">{(outSize / 1024).toFixed(1)} KB</span>）
              </a>
            )}
            {error && <div className="border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">{error}</div>}
            <div className="text-[11px] text-neutral-400">拖动选框移动，拖四角调整大小。</div>
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
