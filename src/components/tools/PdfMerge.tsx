"use client";

/** PDF 合并：多个 PDF 按列表顺序合并（pdf-lib 纯前端，不上传） */
import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

type Item = { file: File; pages: number | null };

export default function PdfMerge() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneUrl, setDoneUrl] = useState("");
  const [doneName, setDoneName] = useState("");

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    setDoneUrl("");
    const added: Item[] = [];
    for (const f of Array.from(list)) {
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        setError(`跳过非 PDF 文件：${f.name}`);
        continue;
      }
      added.push({ file: f, pages: null });
    }
    setItems((prev) => [...prev, ...added]);
    // 异步读页数（失败不阻塞）
    for (const it of added) {
      try {
        const doc = await PDFDocument.load(await it.file.arrayBuffer(), { ignoreEncryption: true });
        const n = doc.getPageCount();
        setItems((prev) => prev.map((x) => (x.file === it.file ? { ...x, pages: n } : x)));
      } catch {
        /* 页数读不出不影响合并阶段的报错提示 */
      }
    }
  }

  function move(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function merge() {
    if (items.length < 2) {
      setError("至少需要 2 个 PDF");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const out = await PDFDocument.create();
      for (const it of items) {
        const src = await PDFDocument.load(await it.file.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      if (doneUrl) URL.revokeObjectURL(doneUrl);
      const url = URL.createObjectURL(blob);
      setDoneUrl(url);
      setDoneName("merged.pdf");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className="cursor-pointer border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 hover:border-neutral-500"
      >
        点击选择多个 PDF，或拖进来（本地合并，不上传）
      </div>
      <input ref={inputRef} type="file" accept=".pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />

      {items.length > 0 && (
        <div className="mt-4 border border-neutral-200">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-neutral-100 px-3 py-2 text-xs last:border-b-0">
              <span className="num w-6 text-neutral-400">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
              <span className="num text-neutral-400">{it.pages != null ? `${it.pages} 页` : "…"}</span>
              <span className="num text-neutral-400">{(it.file.size / 1024 / 1024).toFixed(2)} MB</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-neutral-200 px-1.5 hover:bg-neutral-50 disabled:opacity-30">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-neutral-200 px-1.5 hover:bg-neutral-50 disabled:opacity-30">↓</button>
              <button onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="border border-neutral-200 px-1.5 hover:bg-red-50 hover:text-red-600">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={merge}
          disabled={busy || items.length < 2}
          className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? "合并中…" : `合并 ${items.length} 个 PDF`}
        </button>
        {items.length > 0 && (
          <button onClick={() => { setItems([]); setDoneUrl(""); }}
            className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">清空列表</button>
        )}
        {doneUrl && (
          <a href={doneUrl} download={doneName} className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">
            下载 merged.pdf
          </a>
        )}
      </div>
      {error && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
