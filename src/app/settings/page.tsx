"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Settings = {
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  chatModel: string;
  embedModel: string;
  provider?: "iflink" | "custom";
  embeddingDimension?: number;
  verifiedAt?: number;
};

type TestResult = {
  ok: boolean;
  baseUrl: string;
  provider: "iflink" | "custom";
  models: string[];
  quota?: { amount: string | null; used: string | null };
  chatModelChecked: boolean;
  chatModelAvailable: boolean;
  embedModelChecked: boolean;
  embedDimension: number | null;
  warnings: string[];
  error?: string;
};

type UsageTotals = {
  action: string;
  calls: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

type UsageRow = {
  action: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: number;
};

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [chatModel, setChatModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<UsageTotals[]>([]);
  const [rows, setRows] = useState<UsageRow[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: Settings) => {
        setBaseUrl(d.baseUrl);
        setApiKey(d.apiKey);
        setHasKey(Boolean(d.hasKey));
        setChatModel(d.chatModel);
        setEmbedModel(d.embedModel);
      });
    loadUsage();
  }, []);

  function loadUsage() {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => {
        setTotals(d.totals ?? []);
        setRows(d.rows ?? []);
      });
  }

  async function validate() {
    setValidating(true);
    setTest(null);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, chatModel, embedModel }),
      });
      const data = (await res.json()) as TestResult;
      setTest(data);
      if (data.ok && !hasKey) setHasKey(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          chatModel,
          embedModel,
          embeddingDimension:
            test?.ok && embedModel ? test.embedDimension ?? undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `保存失败 HTTP ${res.status}`);
        return;
      }
      setHasKey(Boolean(apiKey) || hasKey);
      setSaveMsg(
        data.rebuiltEmbeddings > 0
          ? `已保存，并重建 ${data.rebuiltEmbeddings} 个资料分块的向量索引。`
          : "已保存。回到工作台即可使用真实模型。"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearConfig() {
    if (!window.confirm("确定清除模型配置吗？已有资料和历史对话会保留。")) return;
    await fetch("/api/settings", { method: "DELETE" });
    setBaseUrl("");
    setApiKey("");
    setHasKey(false);
    setChatModel("");
    setEmbedModel("");
    setTest(null);
    setSaveMsg("已清除配置，应用回到本地 mock 演示模式。");
  }

  const providerLabel =
    test?.provider === "iflink" ? "IF.Link 词来中转站" : "自定义 OpenAI 兼容接口";

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-900">
            ← 返回工作台
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">模型接入</h1>
          <p className="mt-1 text-sm text-neutral-500">
            所有问答、笔记和向量检索都只经过这里，后续换成 IF.Link 中转站无需改业务代码。
          </p>
        </div>
        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-500">
          OpenAI 兼容
        </span>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="font-medium">接口配置</h2>
        <p className="mt-1 text-xs text-neutral-400">
          可以填写服务根地址或 <code>/v1</code>；误粘完整接口地址也会自动归一化。
        </p>

        <div className="mt-5 space-y-4">
          <Field
            label="Base URL"
            hint="例如 https://token.iflink.tech 或任意兼容服务的 /v1 地址"
          >
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://token.iflink.tech"
              className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </Field>

          <Field
            label="API Key"
            hint={hasKey ? "已保存；输入新 Key 才会覆盖" : "只保存在服务端，界面不会回显完整值"}
          >
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              type="password"
              autoComplete="off"
              className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="聊天模型" hint="必填，例如 deepseek-chat">
              <input
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder="deepseek-chat"
                list="model-options"
                className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
            </Field>
            <Field label="嵌入模型" hint="建议填写；不填会继续使用本地演示向量">
              <input
                value={embedModel}
                onChange={(e) => setEmbedModel(e.target.value)}
                placeholder="bge-m3"
                list="model-options"
                className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
            </Field>
          </div>

          <datalist id="model-options">
            {test?.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={validate}
            disabled={validating || !baseUrl || !apiKey}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {validating ? "测试连接中…" : "测试连接"}
          </button>
          <button
            onClick={save}
            disabled={saving || !baseUrl || !apiKey || !chatModel}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存并启用"}
          </button>
          {hasKey && (
            <button onClick={clearConfig} className="text-xs text-neutral-400 hover:text-red-600">
              清除配置
            </button>
          )}
        </div>

        {test && (
          <div
            className={`mt-4 rounded-lg border p-4 text-sm ${
              test.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <div className="font-medium">
              {test.ok ? `连接成功 · ${providerLabel}` : "连接失败"}
            </div>
            {test.ok && (
              <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                <span>Base URL：{test.baseUrl}</span>
                <span>模型列表：{test.models.length ? `${test.models.length} 个` : "接口未提供"}</span>
                {test.quota && (
                  <>
                    <span>该 Key 可用额度：{test.quota.amount ?? "未返回"}</span>
                    <span>已使用：{test.quota.used ?? "未返回"}</span>
                  </>
                )}
                <span>嵌入维度：{test.embedDimension ?? "未测试"}</span>
              </div>
            )}
            {test.error && <p className="mt-2 text-xs">{test.error}</p>}
            {test.warnings?.map((w) => (
              <p key={w} className="mt-2 text-xs opacity-80">· {w}</p>
            ))}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {saveMsg && <p className="mt-3 text-sm text-emerald-700">{saveMsg}</p>}
      </section>

      <section className="mt-6 rounded-xl border border-neutral-200 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">用量台账</h2>
          <button onClick={loadUsage} className="text-xs text-neutral-500 hover:text-neutral-900">
            刷新
          </button>
        </div>
        {totals.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">还没有模型调用记录。</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {totals.map((t) => (
                <div key={t.action} className="rounded-lg bg-neutral-50 px-4 py-3">
                  <div className="text-xs text-neutral-500">{t.action}</div>
                  <div className="num mt-1 text-lg font-semibold">{t.calls} 次</div>
                  <div className="num text-xs text-neutral-500">
                    P {t.prompt_tokens ?? 0} / C {t.completion_tokens ?? 0}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500">
                    <th className="py-2 font-medium">动作</th>
                    <th className="py-2 font-medium">模型</th>
                    <th className="py-2 font-medium">输入 tok</th>
                    <th className="py-2 font-medium">输出 tok</th>
                    <th className="py-2 font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 15).map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2">{r.action}</td>
                      <td className="mono py-2">{r.model}</td>
                      <td className="num py-2">{r.prompt_tokens}</td>
                      <td className="num py-2">{r.completion_tokens}</td>
                      <td className="py-2 text-neutral-500">
                        {new Date(r.created_at).toLocaleString("zh-CN", { hour12: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-neutral-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

