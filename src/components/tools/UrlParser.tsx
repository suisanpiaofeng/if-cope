"use client";

/** URL 解析与构造：拆解协议/域名/路径/查询参数，可视化编辑参数 */
import { useMemo, useState } from "react";
import { Btn, CopyBtn, Hint, Input } from "./_ui";

export default function UrlParser() {
  const [input, setInput] = useState("");
  const parsed = useMemo(() => {
    try {
      if (!input.trim()) return null;
      const u = new URL(input.trim());
      const params = [...u.searchParams.entries()];
      return { u, params };
    } catch {
      return { error: "URL 无效（需含协议，如 https://）" };
    }
  }, [input]);

  function setParam(k: string, v: string) {
    const u = new URL(input);
    u.searchParams.set(k, v);
    setInput(u.toString());
  }
  function delParam(k: string) {
    const u = new URL(input);
    u.searchParams.delete(k);
    setInput(u.toString());
  }
  function addParam() {
    const u = new URL(input);
    u.searchParams.append("key", "value");
    setInput(u.toString());
  }

  if (parsed && "error" in parsed) {
    return (
      <div className="max-w-[640px]">
        <Input value={input} onChange={setInput} mono placeholder="https://example.com/path?a=1" />
        <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{parsed.error}</div>
      </div>
    );
  }

  const u = parsed && "u" in parsed ? parsed.u : null;
  const params = parsed && "params" in parsed ? parsed.params : [];

  const rows: [string, string][] = u
    ? [
        ["协议", u.protocol.replace(":", "")],
        ["域名", u.hostname],
        ["端口", u.port || "（默认）"],
        ["路径", u.pathname],
        ["锚点", u.hash.replace("#", "") || "（无）"],
        ["完整 URL", u.toString()],
      ]
    : [];

  return (
    <div className="max-w-[680px]">
      <Input value={input} onChange={setInput} mono placeholder="https://example.com/path?a=1#top" />
      {u && (
        <div className="mt-4 space-y-4">
          <div className="border border-neutral-200">
            {rows.map(([k, v], i) => (
              <div key={k} className={`flex items-center gap-3 px-3 py-2 text-xs ${i ? "border-t border-neutral-100" : ""}`}>
                <span className="w-20 shrink-0 text-neutral-400">{k}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-neutral-800">{v}</code>
                <CopyBtn text={v} label="复制" />
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">查询参数（{params.length}）</span>
              <Btn onClick={addParam}>+ 添加参数</Btn>
            </div>
            <div className="space-y-1">
              {params.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <input defaultValue={k} key={`k${i}-${k}`}
                    onBlur={(e) => { if (e.target.value !== k) { delParam(k); const nu = new URL(input); nu.searchParams.append(e.target.value, v); setInput(nu.toString()); } }}
                    className="w-40 rounded border border-neutral-200 px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-400" />
                  <span className="text-neutral-400">=</span>
                  <input defaultValue={v} key={`v${i}-${k}-${v}`}
                    onBlur={(e) => { if (e.target.value !== v) setParam(k, e.target.value); }}
                    className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-400" />
                  <button onClick={() => delParam(k)}
                    className="border border-neutral-200 px-1.5 text-xs text-neutral-400 hover:border-red-300 hover:text-red-600">×</button>
                </div>
              ))}
              {params.length === 0 && <div className="py-2 text-xs text-neutral-400">无查询参数</div>}
            </div>
          </div>
          <Hint text="修改参数后自动重算完整 URL；编辑框失焦即生效。" />
        </div>
      )}
    </div>
  );
}
