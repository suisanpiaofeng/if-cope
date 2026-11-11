"use client";

/** 设置右侧抽屉：接口配置 + 用量台账（原 /settings 独立页改造，逻辑不变） */
import { useEffect, useState } from "react";
import PersonalSection from "./PersonalSection";
import SettingsSkills from "./SettingsSkills";

type Settings = {
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  chatModel: string;
  embedModel: string;
  provider?: "iflink" | "custom";
  embeddingDimension?: number;
  verifiedAt?: number;
  translateBaseUrl?: string;
  translateApiKey?: string;
  translateModel?: string;
  userDirective?: string;
  confirmMode?: "writes" | "all" | "none";
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

export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [chatModel, setChatModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [translateBaseUrl, setTranslateBaseUrl] = useState("");
  const [translateApiKey, setTranslateApiKey] = useState("");
  const [translateModel, setTranslateModel] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<UsageTotals[]>([]);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [tab, setTab] = useState<"model" | "personal" | "skills">("model"); // 三段切换（自审裁决：页面原本无 Tab）
  const [confirmMode, setConfirmMode] = useState<"writes" | "all" | "none">("writes");

  async function saveConfirmMode(mode: "writes" | "all" | "none") {
    setConfirmMode(mode);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmMode: mode }),
    }).catch(() => null);
  }

  // 打开时拉取配置与用量
  useEffect(() => {
    if (!open) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: Settings) => {
        setConfirmMode(d.confirmMode ?? "writes");
        setBaseUrl(d.baseUrl);
        setApiKey(d.apiKey);
        setHasKey(Boolean(d.hasKey));
        setChatModel(d.chatModel);
        setEmbedModel(d.embedModel);
        setTranslateBaseUrl(d.translateBaseUrl ?? "");
        setTranslateApiKey(d.translateApiKey ?? "");
        setTranslateModel(d.translateModel ?? "");
      });
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
          translateBaseUrl,
          translateApiKey,
          translateModel,
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
          : "已保存。即可使用真实模型。"
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

  if (!open) return null;

  const providerLabel =
    test?.provider === "iflink" ? "IF.Link 词来中转站" : "自定义 OpenAI 兼容接口";

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/20" />
      {/* 抽屉面板 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-[480px] max-w-full flex-col border-l border-neutral-200 bg-white shadow-2xl"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">模型接入</h2>
            <p className="mt-0.5 text-[11px] text-neutral-400">OpenAI 兼容 · 问答/笔记/检索都经此处</p>
          </div>
          <button onClick={onClose} aria-label="关闭"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 border-b border-neutral-200 px-5 pt-2">
          {([['model', '模型接入'], ['personal', '个性化'], ['skills', '技能']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium ${
                tab === k
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-400 hover:text-neutral-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* 内容区（滚动） */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "model" ? (
            <>
          {/* 接口配置 */}
          <section>
            <h3 className="text-sm font-medium">接口配置</h3>
            <p className="mt-1 text-xs text-neutral-400">
              可填服务根地址或 <code>/v1</code>；误粘完整接口地址会自动归一化。
            </p>

            <div className="mt-4 space-y-3.5">
              <Field label="Base URL" hint="例如 https://token.iflink.tech">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://token.iflink.tech"
                  className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                />
              </Field>

              <Field label="API Key" hint={hasKey ? "已保存；输入新 Key 才会覆盖" : "只存服务端，不回显完整值"}>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  type="password"
                  autoComplete="off"
                  className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                />
              </Field>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="聊天模型" hint="必填，如 deepseek-chat">
                  <input
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    placeholder="deepseek-chat"
                    list="drawer-model-options"
                    className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  />
                </Field>
                <Field label="嵌入模型" hint="建议填；不填用本地向量">
                  <input
                    value={embedModel}
                    onChange={(e) => setEmbedModel(e.target.value)}
                    placeholder="bge-m3"
                    list="drawer-model-options"
                    className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  />
                </Field>
              </div>

              <datalist id="drawer-model-options">
                {test?.models.map((m) => <option key={m} value={m} />)}
              </datalist>

              {/* 翻译上游 */}
              <div className="rounded-lg border border-neutral-200 p-3.5">
                <div className="text-sm font-medium">翻译模型（可选）</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  三项留空则回退上面的对话模型
                </div>
                <div className="mt-3 space-y-3">
                  <Field label="Base URL" hint="留空 = 用对话模型地址">
                    <input
                      value={translateBaseUrl}
                      onChange={(e) => setTranslateBaseUrl(e.target.value)}
                      placeholder="留空 = 用对话模型的地址"
                      className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="API Key" hint="留空 = 用对话 Key">
                      <input
                        value={translateApiKey}
                        onChange={(e) => setTranslateApiKey(e.target.value)}
                        placeholder="sk-…"
                        type="password"
                        autoComplete="off"
                        className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      />
                    </Field>
                    <Field label="翻译模型" hint="留空 = 用对话模型">
                      <input
                        value={translateModel}
                        onChange={(e) => setTranslateModel(e.target.value)}
                        placeholder="留空 = 用对话模型"
                        list="drawer-model-options"
                        className="mono w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                onClick={validate}
                disabled={validating || !baseUrl || !apiKey}
                className="rounded-lg border border-neutral-200 px-3.5 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                {validating ? "测试连接中…" : "测试连接"}
              </button>
              <button
                onClick={save}
                disabled={saving || !baseUrl || !apiKey || !chatModel}
                className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
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
                className={`mt-3 rounded-lg border p-3.5 text-sm ${
                  test.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                <div className="font-medium">
                  {test.ok ? `连接成功 · ${providerLabel}` : "连接失败"}
                </div>
                {test.ok && (
                  <div className="mt-2 grid gap-1 text-xs">
                    <span>Base URL：{test.baseUrl}</span>
                    <span>模型列表：{test.models.length ? `${test.models.length} 个` : "接口未提供"}</span>
                    {test.quota && (
                      <>
                        <span>可用额度：{test.quota.amount ?? "未返回"}</span>
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

            {error && <p className="mt-2.5 text-sm text-red-600">{error}</p>}
            {saveMsg && <p className="mt-2.5 text-sm text-emerald-700">{saveMsg}</p>}
          </section>

          {/* 安全（harness P0 §4.1）：工具确认模式 */}
          <section className="mt-6 border-t border-neutral-100 pt-5">
            <h3 className="text-sm font-medium">安全</h3>
            <p className="mt-1 text-xs text-neutral-400">
              控制 AI 工具执行前是否需要你确认。危险命令（黑名单）始终拒绝，不受此设置影响。
            </p>
            <div className="mt-3 space-y-2">
              {([
                ["writes", "写操作需确认（推荐）", "文件写入/修改、安装技能、写类命令会先弹确认卡"],
                ["all", "全部操作需确认", "连只读查询也需确认，最严格但交互重"],
                ["none", "全自动执行", "不再弹确认卡；风险自担（写入/命令直接执行）"],
              ] as const).map(([k, label, hint]) => (
                <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50">
                  <input
                    type="radio"
                    name="confirmMode"
                    checked={confirmMode === k}
                    onChange={() => saveConfirmMode(k)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-neutral-800">{label}</span>
                    <span className="block text-xs text-neutral-400">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* 用量台账 */}
          <section className="mt-6 border-t border-neutral-100 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">用量台账</h3>
              <button onClick={loadUsage} className="text-xs text-neutral-500 hover:text-neutral-900">
                刷新
              </button>
            </div>
            {totals.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-400">还没有模型调用记录。</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {totals.map((t) => (
                    <div key={t.action} className="rounded-lg bg-neutral-50 px-3.5 py-2.5">
                      <div className="text-xs text-neutral-500">{t.action}</div>
                      <div className="num mt-1 text-lg font-semibold">{t.calls} 次</div>
                      <div className="num text-xs text-neutral-500">
                        P {t.prompt_tokens ?? 0} / C {t.completion_tokens ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-neutral-500">
                        <th className="py-2 font-medium">动作</th>
                        <th className="py-2 font-medium">模型</th>
                        <th className="py-2 font-medium">输入</th>
                        <th className="py-2 font-medium">输出</th>
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
            </>
          ) : tab === "personal" ? (
            <PersonalSection />
          ) : (
            <SettingsSkills />
          )}
        </div>
      </div>
    </div>
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
