"use client";

/** JWT 解码：解析 Header/Payload/签名，高亮 JSON，本地不校验签名 */
import { useMemo, useState } from "react";
import { Area, CopyBtn, Hint } from "./_ui";

function b64urlToJson(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob((s.replace(/-/g, "+").replace(/_/g, "/")) + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function JwtDecoder() {
  const [token, setToken] = useState("");
  const parsed = useMemo(() => {
    const t = token.trim();
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length !== 3) return { error: "JWT 应由 3 段组成（header.payload.signature）" };
    try {
      const header = JSON.stringify(JSON.parse(b64urlToJson(parts[0])), null, 2);
      const payload = JSON.stringify(JSON.parse(b64urlToJson(parts[1])), null, 2);
      const exp = (() => {
        try {
          const p = JSON.parse(b64urlToJson(parts[1]));
          if (p.exp) {
            const d = new Date(p.exp * 1000);
            const left = d.getTime() - Date.now();
            return { exp: d.toLocaleString("zh-CN", { hour12: false }), expired: left < 0, leftMin: Math.round(left / 60000) };
          }
        } catch { /* ignore */ }
        return null;
      })();
      return { header, payload, sig: parts[2], exp };
    } catch (e) {
      return { error: `解码失败：${e instanceof Error ? e.message : e}` };
    }
  }, [token]);

  return (
    <div className="max-w-[720px]">
      <Area value={token} onChange={setToken} rows={4} mono
        placeholder="粘贴 JWT（eyJ... 开头的三段式 token）" />
      {parsed && "error" in parsed && parsed.error && (
        <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{parsed.error}</div>
      )}
      {parsed && !("error" in parsed) && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Header（算法/类型）</span>
              <CopyBtn text={parsed.header} />
            </div>
            <pre className="max-h-[280px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs">{parsed.header}</pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Payload（载荷）</span>
              <CopyBtn text={parsed.payload} />
            </div>
            <pre className="max-h-[280px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs">{parsed.payload}</pre>
          </div>
          {parsed.exp && (
            <div className="col-span-2 border px-3 py-2 text-xs">
              <span className="text-neutral-500">过期时间：</span>
              <span className="num">{parsed.exp.exp}</span>
              <span className={`ml-2 ${parsed.exp.expired ? "text-red-600" : "text-emerald-600"}`}>
                {parsed.exp.expired ? "已过期" : `未过期（剩 ${parsed.exp.leftMin} 分钟）`}
              </span>
            </div>
          )}
          <div className="col-span-2">
            <div className="mb-1 text-[11px] text-neutral-400">签名段（仅展示，不校验）</div>
            <div className="break-all rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-600">{parsed.sig}</div>
          </div>
        </div>
      )}
      <Hint text="纯本地 base64url 解码，不联网、不校验签名，仅用于查看内容。" />
    </div>
  );
}
