"use client";

/** Univer 表格预览编辑器（P5 试验）：
 *  xlsx/csv 在预览面板中以 Univer Sheets 打开——单元格样式/公式/撤销重做等编辑能力。
 *  数据流：文件 → aoa（SheetJS/CSV 解析）→ Univer 快照；保存：快照 → aoa → 写回文件。 */
import { useEffect, useRef, useState } from "react";
import type { Univer, FUniver } from "@univerjs/presets";
import "@univerjs/preset-sheets-core/lib/index.css";

export type SheetAoa = { name: string; aoa: unknown[][] }[];

/** aoa → Univer 工作簿数据（sheets 为 { [sheetId]: worksheet } map，符合 createWorkbook 签名） */
export function aoaToWorkbookData(name: string, sheets: SheetAoa) {
  const sheetMap: Record<string, { name: string; cellData: Record<number, Record<number, { v: unknown; f?: string }>> }> = {};
  sheets.forEach((s, i) => {
    const id = "sheet-" + i;
    sheetMap[id] = {
      name: s.name.slice(0, 28) || "Sheet" + (i + 1),
      cellData: s.aoa.reduce<Record<number, Record<number, { v: unknown; f?: string }>>>((acc, row, r) => {
        row.forEach((v, c) => {
          if (v == null || v === "") return;
          if (typeof v === "string" && v.startsWith("=")) {
            acc[r] = acc[r] ?? {};
            acc[r][c] = { f: "=" + v.slice(1), v: null };
          } else {
            acc[r] = acc[r] ?? {};
            acc[r][c] = { v };
          }
        });
        return acc;
      }, {}),
    };
  });
  return { id: "wb-" + Date.now().toString(36), name, sheets: sheetMap };
}

export default function UniverSheet({
  sheets,
  fileName,
  onSave,
}: {
  sheets: SheetAoa;
  fileName: string;
  onSave?: (sheets: SheetAoa) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<FUniver | null>(null);
  const univerRef = useRef<Univer | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      // 按需加载：Univer 体积大，仅在首个表格文件打开时进 bundle
      const { createUniver, LocaleType } = await import("@univerjs/presets");
      const { UniverSheetsCorePreset } = await import("@univerjs/preset-sheets-core");
      if (disposed || !containerRef.current) return;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        presets: [UniverSheetsCorePreset({ container: containerRef.current })],
      });
      univerRef.current = univer;
      apiRef.current = univerAPI;
      univerAPI.createWorkbook(aoaToWorkbookData(fileName, sheets) as Parameters<typeof univerAPI.createWorkbook>[0]);
      setReady(true);
    })();
    return () => {
      disposed = true;
      univerRef.current?.dispose();
      univerRef.current = null;
      apiRef.current = null;
    };
    // sheets/fileName 变化即重建（每文件一个标签页，切换即重挂载）
  }, [fileName, JSON.stringify(sheets)]);

  async function save() {
    const api = apiRef.current;
    if (!api || !onSave || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const wb = api.getActiveWorkbook();
      if (!wb) throw new Error("无活动工作簿");
      const out: SheetAoa = [];
      for (const ws of wb.getSheets()) {
        const rows = ws.getMaxRows();
        const cols = ws.getMaxColumns();
        if (!rows || !cols) {
          out.push({ name: ws.getSheetName(), aoa: [] });
          continue;
        }
        // 区 1 起行/列？Facade getRange(row, col, numRows, numColumns) 0 起
        const values = ws.getRange(0, 0, Math.max(1, rows), Math.max(1, cols)).getValues() ?? [];
        const aoa = values.map((row) =>
          (row ?? []).map((c) => {
            if (c == null) return "";
            if (typeof c === "object" && "toString" in c) return String(c);
            return c;
          })
        );
        out.push({ name: ws.getSheetName(), aoa });
      }
      await onSave(out);
      setMsg("已保存");
    } catch (e) {
      setMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/40 px-3 py-1.5">
        <span className="text-[11px] text-neutral-500">📊 Univer 表格编辑</span>
        {onSave && (
          <button
            onClick={() => void save()}
            disabled={!ready || saving}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存 (Ctrl+S)"}
          </button>
        )}
        {msg && <span className="text-[11px] text-emerald-700">{msg}</span>}
        {!ready && <span className="text-[11px] text-neutral-400">加载编辑器…</span>}
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
