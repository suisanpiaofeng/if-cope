"use client";

/** PDF 旋转：整体或按页旋转 90/180/270（pdf-lib） */
import { useRef, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { Actions, Btn, Select } from "./_ui";

type Loaded = { doc: PDFDocument; name: string; pages: number; size: number };
type Deg = 90 | 180 | 270;

export default function PdfRotate() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<Loaded | null>(null);
  const [deg, setDeg] = useState<Deg>(90);
  const [scope, setScope] = useState<"all" | "odd" | "even">("all");
  const [outUrl, setOutUrl] = useState("");
  const [outName, setOutName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onPick(f: File | undefined) {
    if (!f) return;
    setError(""); setOutUrl("");
    try {
      const doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true });
      setPdf({ doc, name: f.name, pages: doc.getPageCount(), size: f.size });
    } catch (e) {
      setError(`打开失败：${e instanceof Error ? e.message : e}`);
    }
  }

  async function rotate() {
    if (!pdf) return;
    setBusy(true); setError("");
    try {
      const out = await PDFDocument.load(await pdf.doc.save());
      const pages = out.getPages();
      pages.forEach((p, i) => {
        const hit = scope === "all" || (scope === "odd" && i % 2 === 0) || (scope === "even" && i % 2 === 1);
        if (hit) {
          const cur = p.getRotation().angle % 360;
          p.setRotation(degrees((cur + deg) % 360));
        }
      });
      const bytes = await out.save();
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" })));
      setOutName(pdf.name.replace(/\.pdf$/i, "") + "-旋转.pdf");
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
            {pdf.name} · <span className="num">{pdf.pages}</span> 页
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <Select label="角度" value={String(deg)} onChange={(v: string) => setDeg(Number(v) as Deg)}
              options={[{ value: "90", label: "顺时针 90°" }, { value: "180", label: "180°" }, { value: "270", label: "逆时针 90°" }]} />
            <Select label="范围" value={scope} onChange={setScope}
              options={[{ value: "all", label: "全部页" }, { value: "odd", label: "奇数页" }, { value: "even", label: "偶数页" }]} />
          </div>
          <Actions>
            <button onClick={rotate} disabled={busy}
              className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40">
              {busy ? "处理中…" : "旋转并生成"}
            </button>
            {outUrl && (
              <a href={outUrl} download={outName}
                className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">下载 {outName}</a>
            )}
          </Actions>
          {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>
      )}
    </div>
  );
}
