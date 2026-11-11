"use client";

/** 技能 Tab（三期规格 §3.5）：SKILL.md 技能管理——查看/新建/编辑/启停/删除（删除二次确认） */
import { useEffect, useRef, useState } from "react";

type Skill = { name: string; description: string; enabled: boolean; body: string; error?: string };

const NEW_BODY = "# 技能标题\n\n按以下步骤执行：\n1. …";

export default function SettingsSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBody, setDraftBody] = useState(NEW_BODY);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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

  function startEdit(s: Skill) {
    setCreating(false);
    setEditing(s);
    setDraftDesc(s.description);
    setDraftBody(s.body);
  }

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setDraftName("");
    setDraftDesc("");
    setDraftBody(NEW_BODY);
  }

  return (
    <div>
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">技能（SKILL.md）</h3>
          <button
            onClick={startCreate}
            className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            + 新建技能
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          技能是可复用的任务指令包：对话中任务匹配技能描述时，AI 会自动加载技能正文并按步骤执行。技能只是指令，不执行任何代码。
        </p>

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
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="mono truncate text-sm font-medium">{s.name}</span>
                    {s.error ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">解析失败</span>
                    ) : (
                      <button
                        onClick={() => toggle(s)}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"
                        }`}
                      >
                        {s.enabled ? "已启用" : "已禁用"}
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">{s.description || "（无触发描述）"}</p>
                  {s.error && <p className="mt-0.5 text-xs text-red-500">{s.error}</p>}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => startEdit(s)}
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
            </div>
          ))}
          {!skills.length && <p className="text-xs text-neutral-400">暂无技能，点右上角「新建技能」创建。</p>}
        </div>

        {err && <p className="mt-2.5 text-sm text-red-600">{err}</p>}
        {msg && <p className="mt-2.5 text-sm text-emerald-700">{msg}</p>}
      </section>
    </div>
  );
}
