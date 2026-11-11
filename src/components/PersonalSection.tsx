"use client";

/** 个性化 Tab（二期规格 §3）：我的偏好（用户指令+偏好库）+ Prompt 自定义（5 场景）+ 用量汇总 */
import { useEffect, useState } from "react";

type PromptItem = { key: string; default: string; override: string | null };
type UsageRow = {
  action: string;
  model: string;
  count: number;
  prompt_tokens: number;
  completion_tokens: number;
};

const PROMPT_LABELS: Record<string, string> = {
  chat_append: "对话追加指令",
  ask_system: "解题答疑",
  artifact_summary: "复习笔记生成",
  map_link: "知识连线（路由+标注）",
  map_analyze: "知识地图体检",
  map_merge: "知识卡合并",
  map_repair: "连线修复",
};

export default function PersonalSection() {
  const [directive, setDirective] = useState("");
  const [prefs, setPrefs] = useState<{ id: number; text: string }[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [days, setDays] = useState<"7" | "30" | "all">("all");
  const [usage, setUsage] = useState<{ rows: UsageRow[]; total: { count: number; prompt_tokens: number; completion_tokens: number } } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setDirective(d.userDirective ?? ""));
    fetch("/api/prefs").then((r) => r.json()).then((d) => setPrefs(d.prefs ?? []));
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((d) => {
        const items: PromptItem[] = d.items ?? [];
        setPrompts(items);
        const init: Record<string, string> = {};
        for (const it of items) init[it.key] = it.override ?? it.default;
        setDrafts(init);
      });
  }, []);

  useEffect(() => {
    fetch(`/api/usage/summary?days=${days}`).then((r) => r.json()).then(setUsage).catch(() => setUsage(null));
  }, [days]);

  async function saveDirective() {
    setErr(null);
    setMsg(null);
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userDirective: directive }),
    }).catch(() => null);
    if (r?.ok) setMsg("用户指令已保存（新对话生效）");
    else setErr("保存失败");
  }

  async function delPref(id: number) {
    const r = await fetch(`/api/prefs?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setPrefs((p) => p.filter((x) => x.id !== id));
  }

  async function savePrompt(key: string) {
    setErr(null);
    setMsg(null);
    const content = drafts[key] ?? "";
    const r = await fetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, content }),
    }).catch(() => null);
    if (r?.ok) {
      setPrompts((ps) => ps.map((p) => (p.key === key ? { ...p, override: content.trim() || null } : p)));
      setMsg(`「${PROMPT_LABELS[key] ?? key}」已保存`);
    } else setErr("保存失败");
  }

  async function resetPrompt(key: string) {
    setErr(null);
    setMsg(null);
    const r = await fetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, content: "" }),
    }).catch(() => null);
    if (r?.ok) {
      setPrompts((ps) => ps.map((p) => (p.key === key ? { ...p, override: null } : p)));
      setDrafts((d) => ({ ...d, [key]: prompts.find((p) => p.key === key)?.default ?? "" }));
      setMsg(`「${PROMPT_LABELS[key] ?? key}」已恢复默认`);
    } else setErr("恢复失败");
  }

  return (
    <div className="space-y-6">
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}

      {/* 一、我的偏好 */}
      <section>
        <h3 className="text-sm font-medium">我的偏好</h3>
        <p className="mt-1 text-xs text-neutral-400">
          用户指令注入所有 AI 场景；长期偏好在对话里说「记住：…」即可添加
        </p>
        <textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          rows={3}
          placeholder="例如：我是通信工程大三学生；回答尽量简洁；公式多推导"
          className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
        <button
          onClick={saveDirective}
          className="mt-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">
          保存用户指令
        </button>
        <div className="mt-3 space-y-1.5">
          {prefs.length === 0 ? (
            <p className="text-xs text-neutral-400">还没有长期偏好（对话里说「记住：…」即可添加）</p>
          ) : (
            prefs.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">{p.text}</span>
                <button onClick={() => delPref(p.id)} className="ml-2 shrink-0 text-neutral-300 hover:text-red-500">
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 二、Prompt 自定义 */}
      <section className="border-t border-neutral-100 pt-5">
        <h3 className="text-sm font-medium">Prompt 自定义</h3>
        <p className="mt-1 text-xs text-neutral-400">留空并保存 = 恢复默认；对话追加指令只做追加，不影响内置骨架</p>
        <div className="mt-2 space-y-3">
          {prompts.map((p) => (
            <details key={p.key} className="rounded-lg border border-neutral-200">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium">
                <span>{PROMPT_LABELS[p.key] ?? p.key}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    p.override ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"
                  }`}>
                  {p.override ? "已自定义" : "默认"}
                </span>
              </summary>
              <div className="px-3 pb-3">
                <textarea
                  value={drafts[p.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                  rows={5}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs outline-none focus:border-neutral-400"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => savePrompt(p.key)}
                    className="rounded-lg bg-neutral-900 px-3 py-1 text-[11px] text-white hover:bg-neutral-700">
                    保存
                  </button>
                  <button
                    onClick={() => resetPrompt(p.key)}
                    className="rounded-lg border border-neutral-200 px-3 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
                    恢复默认
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* 三、用量 */}
      <section className="border-t border-neutral-100 pt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">用量</h3>
          <div className="flex gap-1">
            {(["7", "30", "all"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded px-2 py-0.5 text-[11px] ${
                  days === d ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}>
                {d === "all" ? "全部" : `${d} 天`}
              </button>
            ))}
          </div>
        </div>
        {usage && usage.rows.length > 0 ? (
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-1.5 font-medium">功能</th>
                <th className="py-1.5 font-medium">模型</th>
                <th className="py-1.5 font-medium">次数</th>
                <th className="py-1.5 font-medium">输入</th>
                <th className="py-1.5 font-medium">输出</th>
              </tr>
            </thead>
            <tbody>
              {usage.rows.map((r, i) => (
                <tr key={i} className="border-b border-neutral-100 last:border-0">
                  <td className="py-1.5">{r.action}</td>
                  <td className="mono py-1.5">{r.model}</td>
                  <td className="num py-1.5">{r.count}</td>
                  <td className="num py-1.5">{r.prompt_tokens}</td>
                  <td className="num py-1.5">{r.completion_tokens}</td>
                </tr>
              ))}
              <tr className="text-neutral-500">
                <td className="py-1.5">合计</td>
                <td />
                <td className="num py-1.5">{usage.total.count}</td>
                <td className="num py-1.5">{usage.total.prompt_tokens}</td>
                <td className="num py-1.5">{usage.total.completion_tokens}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-xs text-neutral-400">该时段没有调用记录。</p>
        )}
      </section>
    </div>
  );
}
