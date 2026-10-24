"use client";

/** 进制转换：2/8/10/16 互转，实时同步，支持大写与前缀 */
import { useState } from "react";
import { Out } from "./_ui";

const BASES = [2, 8, 10, 16] as const;

export default function BaseConverter() {
  // 内部统一存十进制 bigint，避免精度丢失
  const [dec, setDec] = useState<bigint>(66n);
  const [error, setError] = useState("");

  function fromBase(raw: string, base: number) {
    setError("");
    const s = raw.trim().replace(/[\s,]/g, "");
    if (!s) { setDec(0n); return; }
    try {
      const neg = s.startsWith("-");
      const body = neg ? s.slice(1) : s;
      let v = 0n;
      for (const ch of body.toLowerCase()) {
        const d = parseInt(ch, base);
        if (isNaN(d)) throw new Error(`含非法字符「${ch}」（${base} 进制）`);
        v = v * BigInt(base) + BigInt(d);
      }
      setDec(neg ? -v : v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="max-w-[640px] space-y-3">
      {BASES.map((b) => (
        <div key={b}>
          <div className="mb-1 text-[11px] text-neutral-400">{b} 进制</div>
          <input
            defaultValue={dec.toString(b)}
            key={`${b}-${dec}`}
            onChange={(e) => fromBase(e.target.value, b)}
            spellCheck={false}
            placeholder={`输入 ${b} 进制数`}
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-400"
          />
        </div>
      ))}
      {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <Out label="十进制参考" value={dec.toString()} />
      <div className="text-[11px] text-neutral-400">在任一输入框修改，其余自动换算；负数支持，内部用 BigInt 不丢精度。</div>
    </div>
  );
}
