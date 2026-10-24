"use client";

/** 图片转 PDF：多图按序合成 PDF，可选页面尺寸（pdf-lib 嵌入） */
import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Actions, Btn, Hint, Select } from "./_ui";

type Img = { file: File; url: string };

const PAGE: Record<string, { w: number; h: number } | null> = {
  fit: null, // 与图片等大
  a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 },
  letter: { w: 612, h: 792 },
};

export default function ImageToPdf() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgs, setImgs] = useState<Img[]>([]);
  const [page, setPage] = useState<keyof typeof PAGE>("fit");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outUrl, setOutUrl] = useState("");

  function add(list: FileList | null) {
    if (!list) return;
    const added: Img[] = [];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) continue;
      added.push({ file: f, url: URL.createObjectURL(f) });
    }
    setImgs((prev) => [...prev, ...added]);
  }

  function move(i: number, d: -1 | 1) {
    setImgs((prev) => { const n = [...prev]; const j = i + d; if (j < 0 || j >= n.length) return prev; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }

  async function build() {
    if (!imgs.length) return;
    setBusy(true); setError("");
    try {
      const doc = await PDFDocument.create();
      const size = PAGE[page];
      for (const it of imgs) {
        const bytes = new Uint8Array(await it.file.arrayBuffer());
        const img = /\.png$/i.test(it.file.name) || it.file.type === "image/png"
          ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const pw = size?.w ?? img.width;
        const ph = size?.h ?? img.height;
        const s = Math.min(pw / img.width, ph / img.height);
        const w = img.width * s, h = img.height * s;
        const p = doc.addPage([pw, ph]);
        p.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
      const bytes = await doc.save();
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
        className="cursor-pointer border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 hover:border-neutral-500">
        点击选择多张图片，或拖进来（支持 JPG/PNG，本地合成不上传）
      </div>

      {imgs.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="border border-neutral-200">
            {imgs.map((it, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-neutral-100 px-3 py-2 text-xs last:border-b-0">
                <span className="num w-6 text-neutral-400">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt="" className="h-10 w-10 border border-neutral-200 object-cover" />
                <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-neutral-200 px-1.5 hover:bg-neutral-50 disabled:opacity-30">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === imgs.length - 1} className="border border-neutral-200 px-1.5 hover:bg-neutral-50 disabled:opacity-30">↓</button>
                <button onClick={() => { URL.revokeObjectURL(it.url); setImgs((p) => p.filter((_, j) => j !== i)); }} className="border border-neutral-200 px-1.5 hover:bg-red-50 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
          <Actions>
            <Select label="页面" value={page} onChange={setPage}
              options={[{ value: "fit", label: "与图片等大" }, { value: "a4", label: "A4" }, { value: "a5", label: "A5" }, { value: "letter", label: "Letter" }]} />
            <button onClick={build} disabled={busy}
              className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40">
              {busy ? "合成中…" : `合成 ${imgs.length} 张`}
            </button>
            {outUrl && (
              <a href={outUrl} download="images.pdf"
                className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">下载 PDF</a>
            )}
          </Actions>
          {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <Hint text="PNG/JPG 直接无损嵌入；「与图片等大」时每页尺寸随图片，适合扫描件。" />
        </div>
      )}
    </div>
  );
}
