"use client";

/** JSON ↔ CSV 互转（手写引号解析），支持数组-of-对象 与 扁平对象 */
import { useMemo, useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

type Dir = "json2csv" | "csv2json";

/** CSV → 数组对象（处理引号包裹、双写转义、分隔符） */
export function csvToObjects(text: string, delim = ","): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!clean.length) return [];
  const header = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

/** 数组对象 → CSV（含引号转义） */
export function objectsToCsv(arr: Record<string, unknown>[], delim = ","): string {
  if (!arr.length) return "";
  const cols: string[] = [];
  for (const o of arr) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(delim)];
  for (const o of arr) lines.push(cols.map((c) => esc(o[c])).join(delim));
  return lines.join("\n");
}

export default function JsonCsv() {
  const [dir, setDir] = useState<Dir>("json2csv");
  const [delim, setDelim] = useState<"," | ";" | "\t">(",");
  const [input, setInput] = useState('[\n  { "id": 1, "name": "张三", "score": 95 },\n  { "id": 2, "name": "李四", "score": 88 }\n]');
  const [error, setError] = useState("");

  const output = useMemo(() => {
    setError("");
    if (!input.trim()) return "";
    try {
      if (dir === "json2csv") {
        const data = JSON.parse(input);
        const arr = Array.isArray(data) ? data : [data];
        if (arr.some((x) => typeof x !== "object" || x === null || Array.isArray(x)))
          throw new Error("JSON→CSV 需要对象数组（如 [{...},{...}]）");
        return objectsToCsv(arr, delim);
      }
      return JSON.stringify(csvToObjects(input, delim), null, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  }, [input, dir, delim]);

  return (
    <div className="max-w-[860px]">
      <Actions>
        <Select label="方向" value={dir} onChange={setDir}
          options={[{ value: "json2csv", label: "JSON → CSV" }, { value: "csv2json", label: "CSV → JSON" }]} />
        <Select label="分隔符" value={delim} onChange={setDelim}
          options={[{ value: ",", label: "逗号 ," }, { value: ";", label: "分号 ;" }, { value: "\t", label: "制表符" }]} />
        <Btn onClick={() => { setInput(output); setDir(dir === "json2csv" ? "csv2json" : "json2csv"); }}>结果→输入</Btn>
        <CopyBtn text={output} />
      </Actions>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2csv" ? "JSON（对象数组）" : "CSV 文本"}</div>
          <Area value={input} onChange={setInput} rows={18} mono />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2csv" ? "CSV 输出" : "JSON 输出"}</div>
          {error ? <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : <Out value={output} />}
        </div>
      </div>
    </div>
  );
}
