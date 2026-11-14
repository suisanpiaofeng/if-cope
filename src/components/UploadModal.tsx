"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "file" | "site" | "text";

const ACCEPT =
  ".pdf,.docx,.pptx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.mp4,.py,.js,.jsx,.ts,.tsx,.json,.html,.css,.scss,.sql,.sh,.bash,.java,.go,.rs,.c,.cpp,.h,.hpp,.cs,.php,.swift,.kt,.dart,.vue,.yaml,.yml,.toml,.xml";

/** 添加资料弹窗：上传文件 / 网站 / 复制的文字 三种方式（参考 NotebookLM 形式） */
export default function UploadModal({
  open, defaultCategoryId, categories, onClose, onUpload, onAddLink, onAddText,
}: {
  open: boolean;
  defaultCategoryId: number | null;
  categories: { id: number; name: string }[];
  onClose: () => void;
  onUpload: (files: File[], categoryId: number | null, opts?: { path?: string; autoIndex?: boolean }) => Promise<void>;
  onAddLink: (url: string, categoryId: number | null) => Promise<void>;
  onAddText: (text: string, categoryId: number | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("file");
  const [categoryId, setCategoryId] = useState<number | null>(defaultCategoryId);
  const [savePath, setSavePath] = useState("资料");
  const [autoIndex, setAutoIndex] = useState(true);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode("file");
      setCategoryId(defaultCategoryId);
      setSavePath("资料");
      setAutoIndex(true);
      setUrl(""); setText(""); setError(null); setDrag(false); setBusy(false);
    }
  }, [open, defaultCategoryId]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submitFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setError(null);
    try { await onUpload(files, categoryId, { path: savePath.trim() || "资料", autoIndex }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function submitLink() {
    const u = url.trim();
    if (!u || busy) return;
    if (!/^https?:\/\//.test(u)) { setError("链接需以 http(s):// 开头"); return; }
    setBusy(true); setError(null);
    try { await onAddLink(u, categoryId); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function submitText() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(null);
    try { await onAddText(t, categoryId); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const modes: { key: Mode; label: string; icon: React.ReactNode }[] = [
    {
      key: "file", label: "上传文件",
      icon: <path d="M8 10.5V2.5m0 0L5 5.5m3-3 3 3M2.5 10v2.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V10" />,
    },
    {
      key: "site", label: "网站",
      icon: <><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c-3.5 3.5-3.5 7.5 0 11 3.5-3.5 3.5-7.5 0-11Z" /></>,
    },
    {
      key: "text", label: "复制的文字",
      icon: <><rect x="5.5" y="3.5" width="7" height="9" rx="1.2" /><path d="M4 5.5v6.2c0 .7.6 1.3 1.3 1.3M10.5 6h-3M10.5 8.3h-3" /></>,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="w-[560px] max-w-full overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-base font-semibold">添加资料</h2>
          <button onClick={onClose} aria-label="关闭"
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 方式切换 */}
        <div className="flex gap-2 px-5 pt-4">
          {modes.map((m) => (
            <button key={m.key} onClick={() => { setMode(m.key); setError(null); }}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                mode === m.key
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
              }`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                {m.icon}
              </svg>
              {m.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="px-5 py-4">
          {mode === "file" && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); submitFiles(Array.from(e.dataTransfer.files)); }}
              onClick={() => fileInput.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                drag ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 hover:border-neutral-500"
              }`}
            >
              <svg className="h-6 w-6 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 10.5V2.5m0 0L5 5.5m3-3 3 3M2.5 10v2.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V10" />
              </svg>
              <p className="mt-3 text-[13px] text-neutral-600">拖放文件即可上传，或点击选择</p>
              <p className="mt-1 text-xs text-neutral-400">支持 PDF、Word、PPT、Markdown、图片、音频、代码，等等。</p>
              <input
                ref={fileInput} type="file" multiple hidden accept={ACCEPT}
                onChange={(e) => { if (e.target.files) submitFiles(Array.from(e.target.files)); e.target.value = ""; }}
              />
            </div>
          )}

          {mode === "site" && (
            <div className="flex gap-2">
              <input
                value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitLink()}
                placeholder="https://… 粘贴网页链接"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
              <button onClick={submitLink} disabled={busy || !url.trim()}
                className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
                收藏
              </button>
            </div>
          )}

          {mode === "text" && (
            <div className="space-y-2">
              <textarea
                value={text} onChange={(e) => setText(e.target.value)}
                placeholder="粘贴一段文字（课堂笔记、摘录、题目…），将作为文本资料入库"
                rows={6} autoFocus
                className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
              <div className="flex justify-end">
                <button onClick={submitText} disabled={busy || !text.trim()}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
                  添加
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* 底部：存入位置 */}
        <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            存入
            <select
              value={categoryId ?? "ungrouped"}
              onChange={(e) => setCategoryId(e.target.value === "ungrouped" ? null : Number(e.target.value))}
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none"
            >
              <option value="ungrouped">未归类</option>
              {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            保存到
            <input
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder="资料"
              className="w-24 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={autoIndex} onChange={(e) => setAutoIndex(e.target.checked)} />
            自动入库（问答可用）
          </label>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-900">取消</button>
        </div>
      </div>
    </div>
  );
}
