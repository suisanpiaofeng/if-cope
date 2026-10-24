"use client";

/** CSV 预览 / 清洗：粘贴或选文件 → 表格可视化 + 统计 + 去重/去空行导出 */
import { useMemo, useRef, useState } from "react";
import { csvToObjects } from "./JsonCsv";
import { Actions, Btn, CopyBtn, Select } from "./_ui";

export default function CsvViewer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [delim, setDelim] = useState<"," | ";" | "\t">(",");
  const [fileName, setFileName] = useState("");
  const [maxRows, setMaxRows] = useState(50);

  const { rows, cols, error } = useMemo(() => {
    if (!text.trim()) return { rows: [] as Record<string, string>[], cols: [] as string[], error: "" };
    try {
      const objs = csvToObjects(text, delim);
      const c = objs.length ? Object.keys(objs[0]) : [];
      return { rows: objs, cols: c, error: "" };
    } catch (e) {
      return { rows: [], cols: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, delim]);

  function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    f.text().then(setText);
  }

  function dedupe(): string {
    const seen = new Set<string>();
    const out: Record<string, string>[] = [];
    for (const r of rows) {
      const key = JSON.stringify(r);
      if (!seen.has(key)) { seen.add(key); out.push(r); }
    }
    return toCsv(out);
  }
  function dropEmpty(): string {
    const out = rows.filter((r) => Object.values(r).some((v) => v.trim() !== ""));
    return toCsv(out);
  }

  function toCsv(arr: Record<string, string>[]): string {
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [cols.join(delim)];
    for (const o of arr) lines.push(cols.map((c) => esc(o[c] ?? "")).join(delim));
    return lines.join("\n");
  }

  const shown = rows.slice(0, maxRows);

  return (
    <div className="max-w-[900px]">
      <Actions>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <Btn onClick={() => fileRef.current?.click()}>选择 CSV 文件</Btn>
        <Select label="分隔符" value={delim} onChange={setDelim}
          options={[{ value: ",", label: "逗号" }, { value: ";", label: "分号" }, { value: "\t", label: "制表符" }]} />
        {rows.length > 0 && (
          <>
            <Select label="行数" value={String(maxRows)} onChange={(v: string) => setMaxRows(Number(v))}
              options={[{ value: "20", label: "20" }, { value: "50", label: "50" }, { value: "200", label: "200" }]} />
            <Btn onClick={() => setText(dedupe())}>去重</Btn>
            <Btn onClick={() => setText(dropEmpty())}>去空行</Btn>
            <CopyBtn text={toCsv(rows)} label="复制 CSV" />
          </>
        )}
      </Actions>

      {!text.trim() && (
        <div onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
          className="cursor-pointer border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 hover:border-neutral-500">
          点击选择或拖入 CSV 文件（本地解析，不上传）
        </div>
      )}

      {error && <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {rows.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-4 text-xs text-neutral-500">
            {fileName && <span>{fileName}</span>}
            <span className="num">{rows.length} 行 × {cols.length} 列</span>
            <span>显示前 {shown.length} 行</span>
          </div>
          <div className="overflow-auto rounded-md border border-neutral-200" style={{ maxHeight: 480 }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>{cols.map((c) => (
                  <th key={c} className="sticky top-0 border-b border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-left font-medium text-neutral-700">{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={i % 2 ? "bg-neutral-50/50" : ""}>
                    {cols.map((c) => (
                      <td key={c} className="border-b border-neutral-100 px-2.5 py-1.5 text-neutral-700">{r[c]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
