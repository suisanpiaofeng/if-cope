"use client";

/** PDF 拆分 / 提取页：按范围抽取若干页生成新 PDF（pdf-lib，本地不上传） */
import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Actions, Btn, Hint, Input, NumInput } from "./_ui";

type Loaded = { doc: PDFDocument; name: string; pages: number; size: number };

/** 解析 "1-3,5,8-" 为页码索引数组（0-based） */
export function parseRanges(expr: string, total: number): number[] {
  const out = new Set<number>();
  for (const part of expr.split(/[,，]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)?$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1]));
      const b = m[2] ? Math.min(total, parseInt(m[2])) : total;
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part);
      if (n >= 1 && n <= total) out.add(n - 1);
    } else {
      throw new Error(`无法解析「${part}」，示例：1-3,5,8-10`);
    }
  }
  return [...out].sort((x, y) => x - y);
}

export default function PdfSplit() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<Loaded | null>(null);
  const [expr, setExpr] = useState("");
  const [error, setError] = useState("");
  const [outUrl, setOutUrl] = useState("");
  const [outName, setOutName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onPick(f: File | undefined) {
    if (!f) return;
    setError(""); setOutUrl("");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      setPdf({ doc, name: f.name, pages: doc.getPageCount(), size: f.size });
      setExpr(`1-${doc.getPageCount()}`);
    } catch (e) {
      setError(`打开失败：${e instanceof Error ? e.message : e}`);
    }
  }

  async function split(extract: boolean) {
    if (!pdf) return;
    setBusy(true); setError("");
    try {
      const idx = parseRanges(expr, pdf.pages);
      if (!idx.length) throw new Error("未选中任何页");
      const out = await PDFDocument.create();
      const copied = await out.copyPages(pdf.doc, idx);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      if (outUrl) URL.revokeObjectURL(outUrl);
      const base = pdf.name.replace(/\.pdf$/i, "");
      setOutUrl(URL.createObjectURL(blob));
      setOutName(`${base}-${extract ? "提取" : "拆分"}${idx.length}页.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[640px]">
      <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files[0]); }}
        className="cursor-pointer border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 hover:border-neutral-500">
        点击选择 PDF，或拖进来（本地处理，不上传）
      </div>

      {pdf && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-neutral-600">
            {pdf.name} · <span className="num">{pdf.pages}</span> 页 · <span className="num">{(pdf.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">页范围</span>
            <Input value={expr} onChange={setExpr} mono placeholder="如 1-3,5,8-10" />
          </div>
          <Actions>
            <Btn onClick={() => setExpr(`1-${pdf.pages}`)}>全选</Btn>
            <Btn onClick={() => setExpr("1")}>仅第 1 页</Btn>
            <Btn onClick={() => setExpr(`${Math.max(1, pdf.pages - 9)}-${pdf.pages}`)}>末 10 页</Btn>
          </Actions>
          <Actions>
            <button onClick={() => split(true)} disabled={busy}
              className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40">
              {busy ? "处理中…" : "提取选中页"}
            </button>
            {outUrl && (
              <a href={outUrl} download={outName}
                className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">下载 {outName}</a>
            )}
          </Actions>
          {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <Hint text="支持范围语法：1-3（连续）、5（单页）、8-（到末尾），逗号分隔多段。" />
        </div>
      )}
    </div>
  );
}
