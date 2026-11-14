"use client";

/** 技能 Tab（harness P0 §2.4）：上传 .md/文件夹/拖拽安装、冲突弹窗（覆盖/重命名/跳过）、
 *  详情展开、启停/编辑/删除（二次确认）、重新加载。 */
import { useEffect, useRef, useState } from "react";
import ErrorBanner from "./ErrorBanner";

type Skill = { name: string; description: string; enabled: boolean; body: string; triggers?: string; params?: string; error?: string };
type ImportItem = { path: string; content: string };
type ConflictItem = { path: string; name: string; description: string; existing: { name: string; description: string } };
type ImportErrorItem = { path: string; error: string };
type Resolution = "overwrite" | "rename" | "skip";

const NEW_BODY = "# 技能标题\n\n按以下步骤执行：\n1. …";
const RES_LABELS: Record<Resolution, string> = { overwrite: "覆盖", rename: "重命名", skip: "跳过" };

export default function SettingsSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBody, setDraftBody] = useState(NEW_BODY);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 导入流程状态
  const [busy, setBusy] = useState(false);
  const [pendingItems, setPendingItems] = useState<ImportItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [importErrors, setImportErrors] = useState<ImportErrorItem[]>([]);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d: { skills?: Skill[] }) => setSkills(d.skills ?? []))
      .catch(() => setSkills([]));
  }
  useEffect(() => {
    load();
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  async function put(skill: { name: string; description: string; body: string; enabled: boolean }) {
    setErr(null);
    setMsg(null);
    const r = await fetch("/api/skills", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    }).catch(() => null);
    if (!r?.ok) {
      const d = await r?.json().catch(() => null);
      setErr(d?.error ?? "保存失败，请重试");
      return false;
    }
    setMsg(`已保存技能「${skill.name}」`);
    load();
    return true;
  }

  async function toggle(s: Skill) {
    await put({ name: s.name, description: s.description, body: s.body, enabled: !s.enabled });
  }

  async function remove(name: string) {
    setErr(null);
    setMsg(null);
    const r = await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) {
      const d = await r?.json().catch(() => null);
      setErr(d?.error ?? "删除失败，请重试");
    } else {
      setMsg(`已删除技能「${name}」`);
      load();
    }
    setConfirmName(null);
  }

  function askRemove(name: string) {
    if (confirmName === name) {
      remove(name);
      return;
    }
    setConfirmName(name);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmName(null), 3000);
  }

  // ── 导入（两步式）──
  async function importItems(items: ImportItem[], res?: Record<string, Resolution>) {
    if (!items.length) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, resolutions: res }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) {
        setPendingItems(items);
        setConflicts(d.conflicts ?? []);
        setResolutions({});
        setImportErrors(d.errors ?? []);
        return;
      }
      if (!r.ok) {
        setErr(d.error ?? "导入失败，请重试");
        return;
      }
      setConflicts(null);
      setPendingItems([]);
      setImportErrors(d.errors ?? []);
      setMsg(`已安装 ${d.installed?.length ?? 0} 个技能${d.renamed?.length ? `（重命名 ${d.renamed.length} 个）` : ""}${d.skipped?.length ? `（跳过 ${d.skipped.length} 个）` : ""}`);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function submitWithResolutions() {
    const merged: Record<string, Resolution> = { ...resolutions };
    for (const c of conflicts ?? []) merged[c.path] ??= "skip";
    await importItems(pendingItems, merged);
  }

  /** 拖拽/文件夹递归收集 .md（webkitGetAsEntry） */
  async function collectEntries(items: DataTransferItemList): Promise<ImportItem[]> {
    const out: ImportItem[] = [];
    async function walk(entry: any, prefix: string) {
      if (entry.isFile) {
        const file: File = await new Promise((res, rej) => entry.file(res, rej));
        const p = prefix + file.name;
        if (/\.md$/i.test(p)) out.push({ path: p, content: await file.text() });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const batch: any[] = await new Promise((res) => reader.readEntries(res));
        for (const e of batch) await walk(e, prefix + entry.name + "/");
      }
    }
    for (const it of Array.from(items)) {
      const entry = (it as any).webkitGetAsEntry?.();
      if (entry) await walk(entry, "");
    }
    return out;
  }

  async function onFilesSelected(files: FileList | null, useRelative = false) {
    if (!files?.length) return;
    const items: ImportItem[] = [];
    for (const f of Array.from(files)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
      const p = useRelative && rel ? rel : f.name;
      if (/\.md$/i.test(p)) items.push({ path: p, content: await f.text() });
    }
    if (!items.length) {
      setErr("没有 .md 文件可导入");
      return;
    }
    importItems(items);
  }

  /** 命名后安装（错误条目重试：补 frontmatter name 头再提交单件） */
  async function renameInstall(item: ImportErrorItem) {
    const name = (renameDrafts[item.path] ?? "").trim();
    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      setErr("技能名非法：仅允许小写字母/数字/连字符，≤40 位");
      return;
    }
    const src = pendingItems.find((i) => i.path === item.path);
    if (!src) return;
    importItems([{ path: src.path, content: `---\nname: ${name}\n---\n${src.content}` }]);
  }

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer.items?.length) return;
        e.preventDefault();
        setBusy(true);
        try {
          const items = await collectEntries(e.dataTransfer.items);
          if (items.length) await importItems(items);
          else setErr("拖入的内容里没有 .md 文件（支持文件/文件夹）");
        } finally {
          setBusy(false);
        }
      }}
    >
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">技能（SKILL.md）</h3>
          <div className="flex gap-1.5">
            <label className={`cursor-pointer rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 ${busy ? "pointer-events-none opacity-50" : ""}`}>
              + 上传 .md
              <input type="file" accept=".md" multiple hidden onChange={(e) => onFilesSelected(e.target.files)} />
            </label>
            <label className={`cursor-pointer rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 ${busy ? "pointer-events-none opacity-50" : ""}`}>
              + 上传文件夹
              <input
                type="file"
                // @ts-expect-error webkitdirectory 非标准属性（浏览器均支持）
                webkitdirectory=""
                multiple
                hidden
                onChange={(e) => onFilesSelected(e.target.files, true)}
              />
            </label>
            <button
              onClick={() => {
                setErr(null);
                setMsg(null);
                load();
                setMsg("已重新加载技能列表（文件即真源）");
              }}
              className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              ↻ 重新加载
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setCreating(true);
                setDraftName("");
                setDraftDesc("");
                setDraftBody(NEW_BODY);
              }}
              className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700"
            >
              + 新建技能
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          技能是可复用的任务指令包：对话中任务匹配技能描述时，AI 会自动加载并按步骤执行。支持上传 .md 或整个文件夹（递归扫描批量安装，冲突可逐项覆盖/重命名/跳过）；也可直接把 .md/文件夹拖进本区域。技能只是指令，不执行任何代码。
        </p>

        {/* 冲突决策弹窗（两步式第 2 步） */}
        {conflicts && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/70 p-3.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-amber-800">存在同名技能，请逐项选择处理方式</h4>
              <div className="flex gap-1.5 text-xs">
                {(["overwrite", "rename", "skip"] as Resolution[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolutions(Object.fromEntries(conflicts.map((c) => [c.path, r])))}
                    className="rounded border border-amber-300 px-2 py-0.5 text-amber-700 hover:bg-white"
                  >
                    全部{RES_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {conflicts.map((c) => (
                <div key={c.path} className="rounded border border-amber-200 bg-white px-3 py-2 text-xs">
                  <div className="font-medium">{c.path} → 「{c.name}」</div>
                  <div className="mt-0.5 text-neutral-500">
                    新：{c.description || "（无描述）"} ｜ 已有：{c.existing.description || "（无描述）"}
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    {(["overwrite", "rename", "skip"] as Resolution[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolutions((p) => ({ ...p, [c.path]: r }))}
                        className={`rounded px-2 py-0.5 border ${
                          resolutions[c.path] === r
                            ? "border-amber-600 bg-amber-600 text-white"
                            : "border-amber-300 text-amber-700 hover:bg-white"
                        }`}
                      >
                        {RES_LABELS[r]}
                      </button>
                    ))}
                    {!resolutions[c.path] && <span className="text-amber-500">未选（按跳过处理）</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={submitWithResolutions}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                确认导入
              </button>
              <button
                onClick={() => {
                  setConflicts(null);
                  setPendingItems([]);
                }}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-white"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 导入错误 + 命名重试 */}
        {importErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-xs">
            <div className="font-medium text-red-700">以下文件安装失败：</div>
            {importErrors.map((e) => (
              <div key={e.path} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-red-600">{e.path} — {e.error}</span>
                {pendingItems.some((i) => i.path === e.path) && (
                  <>
                    <input
                      value={renameDrafts[e.path] ?? ""}
                      onChange={(ev) => setRenameDrafts((p) => ({ ...p, [e.path]: ev.target.value }))}
                      placeholder="换个技能名（小写字母/数字/连字符）"
                      className="rounded border border-red-200 px-2 py-0.5"
                    />
                    <button
                      onClick={() => renameInstall(e)}
                      className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-white"
                    >
                      命名安装
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 新建 / 编辑 */}
        {(creating || editing) && (
          <div className="mt-3 space-y-2.5 rounded-lg border border-neutral-200 p-3.5">
            {creating ? (
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="技能名（小写字母/数字/连字符，如 exam-plan）"
                className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
              />
            ) : (
              <div className="text-sm font-medium">编辑技能：{editing!.name}</div>
            )}
            <input
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="触发描述：什么时候该用这个技能（供 AI 判断）"
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={10}
              placeholder="技能正文（Markdown，AI 加载后遵循的步骤）"
              className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs outline-none focus:border-neutral-400"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const name = creating ? draftName.trim() : editing!.name;
                  if (creating && !/^[a-z0-9-]{1,40}$/.test(name)) {
                    setErr("技能名非法：仅允许小写字母/数字/连字符，1~40 位");
                    return;
                  }
                  const ok = await put({ name, description: draftDesc, body: draftBody, enabled: editing?.enabled ?? true });
                  if (ok) {
                    setEditing(null);
                    setCreating(false);
                  }
                }}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 列表 */}
        <div className="mt-3 space-y-2.5">
          {skills.map((s) => (
            <div key={s.name} className="rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                >
                  <div className="flex items-center gap-2">
                    <span className="mono truncate text-sm font-medium">{s.name}</span>
                    {s.error ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">解析失败</span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(s);
                        }}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"
                        }`}
                      >
                        {s.enabled ? "已启用" : "已禁用"}
                      </button>
                    )}
                    <span className="text-[10px] text-neutral-300">{expanded === s.name ? "▲ 收起" : "▼ 详情"}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">{s.description || "（无触发描述）"}</p>
                  {s.error && <p className="mt-0.5 text-xs text-red-500">{s.error}</p>}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => {
                      setCreating(false);
                      setEditing(s);
                      setDraftDesc(s.description);
                      setDraftBody(s.body);
                    }}
                    className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => askRemove(s.name)}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      confirmName === s.name
                        ? "border-red-300 bg-red-50 text-red-600"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {confirmName === s.name ? "确认删除？" : "删除"}
                  </button>
                </div>
              </div>
              {expanded === s.name && (
                <div className="mt-2 border-t border-neutral-100 pt-2 text-xs">
                  {s.triggers && <p className="text-neutral-500"><b>触发条件：</b>{s.triggers}</p>}
                  {s.params && <p className="mt-1 text-neutral-500"><b>参数：</b>{s.params}</p>}
                  <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2.5 text-[11px] leading-5 text-neutral-700">
                    {s.body || "（空正文）"}
                  </pre>
                </div>
              )}
            </div>
          ))}
          {!skills.length && <p className="text-xs text-neutral-400">暂无技能：上传 .md/文件夹，或点「新建技能」创建。</p>}
        </div>

        {busy && <p className="mt-2.5 text-xs text-neutral-400">处理中…</p>}
        {err && <div className="mt-2.5"><ErrorBanner message={err} /></div>}
        {msg && <p className="mt-2.5 text-sm text-emerald-700">{msg}</p>}
      </section>
    </div>
  );
}
