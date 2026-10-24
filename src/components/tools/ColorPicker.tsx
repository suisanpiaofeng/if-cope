"use client";

/** 取色器：上传图片点选取色 + 调色板，输出 HEX/RGB/HSL，含配色复制 */
import { useEffect, useRef, useState } from "react";
import { Actions, Btn, CopyBtn } from "./_ui";

export default function ColorPicker() {
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState("");
  const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [palette, setPalette] = useState<string[]>([]);

  async function onPick(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    if (src) URL.revokeObjectURL(src); // 释放旧图
    const url = URL.createObjectURL(f);
    setSrc(url);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = () => rej(new Error("读取失败")); img.src = url; });
    const canvas = canvasRef.current!;
    // 限宽 480 渲染
    const scale = Math.min(1, 480 / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    extractPalette();
  }

  function extractPalette() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // 量化到 4bit/通道，统计主要颜色并求均值
    const map = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 80) { // 采样
      if (data[i + 3] < 128) continue;
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      const cur = map.get(key);
      if (cur) {
        cur.n++;
        cur.r = (cur.r * (cur.n - 1) + data[i]) / cur.n;
        cur.g = (cur.g * (cur.n - 1) + data[i + 1]) / cur.n;
        cur.b = (cur.b * (cur.n - 1) + data[i + 2]) / cur.n;
      } else {
        map.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
    const top = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    setPalette(top.map((t) => toHex(Math.round(t.r), Math.round(t.g), Math.round(t.b))));
  }

  function pick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    const d = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
    setColor({ r: d[0], g: d[1], b: d[2] });
  }

  const hex = color ? toHex(color.r, color.g, color.b) : "";
  const rgbStr = color ? `rgb(${color.r}, ${color.g}, ${color.b})` : "";
  const hslStr = color ? rgbToHsl(color.r, color.g, color.b) : "";

  return (
    <div className="max-w-[860px]">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      <Actions>
        <Btn onClick={() => fileRef.current?.click()}>选择图片</Btn>
        {color && <CopyBtn text={hex} label="复制 HEX" />}
      </Actions>

      {!src && (
        <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
          className="cursor-pointer border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 hover:border-neutral-500">
          点击选择图片，或拖进来；点图取色（本地处理，不上传）
        </div>
      )}

      {src && (
        <div className="flex gap-4">
          <canvas ref={canvasRef} onClick={pick} className="max-h-[440px] cursor-crosshair border border-neutral-200" />
          <div className="w-52 shrink-0 space-y-3">
            {color && (
              <>
                <div className="h-16 w-full border border-neutral-200" style={{ background: hex }} />
                <div className="space-y-1 text-xs">
                  <Row label="HEX" v={hex} />
                  <Row label="RGB" v={rgbStr} />
                  <Row label="HSL" v={hslStr} />
                </div>
              </>
            )}
            {palette.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-neutral-400">主要配色（点击取色）</div>
                <div className="grid grid-cols-4 gap-1">
                  {palette.map((c, i) => (
                    <button key={i} title={c}
                      onClick={() => { const { r, g, b } = hexToRgb(c); setColor({ r, g, b }); }}
                      className="h-9 border border-neutral-200" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-1"><CopyBtn text={palette.join(", ")} label="复制全部配色" /></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-400">{label}</span>
      <code className="font-mono text-neutral-800">{v}</code>
    </div>
  );
}

function toHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function hexToRgb(hex: string) {
  const m = hex.replace("#", "");
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
