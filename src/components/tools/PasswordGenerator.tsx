"use client";

/** 随机密码生成：可调长度/字符集，crypto 安全，附强度评估 */
import { useMemo, useState } from "react";
import { Actions, Btn, CopyBtn, NumInput, Out, PrimaryBtn } from "./_ui";

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digit: "23456789",
  symbol: "!@#$%^&*-_=+?",
};

function gen(len: number, use: Record<string, boolean>): string {
  let pool = "";
  if (use.lower) pool += SETS.lower;
  if (use.upper) pool += SETS.upper;
  if (use.digit) pool += SETS.digit;
  if (use.symbol) pool += SETS.symbol;
  if (!pool) return "";
  const rnd = crypto.getRandomValues(new Uint32Array(len));
  return [...rnd].map((r) => pool[r % pool.length]).join("");
}

export function passwordScore(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "空" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ["很弱", "弱", "一般", "中等", "强", "很强"];
  return { score: s, label: labels[Math.min(s, 5)] };
}

export default function PasswordGenerator() {
  const [len, setLen] = useState(16);
  const [use, setUse] = useState({ lower: true, upper: true, digit: true, symbol: true });
  const [pw, setPw] = useState("");
  const strength = useMemo(() => passwordScore(pw), [pw]);

  function toggle(k: keyof typeof use) {
    const next = { ...use, [k]: !use[k] };
    // 至少保留一个字符集
    if (Object.values(next).some(Boolean)) setUse(next);
  }

  return (
    <div className="max-w-[560px] space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-neutral-500">长度</span>
        <NumInput value={len} onChange={setLen} min={4} max={64} className="w-24" />
        <div className="flex gap-2 text-xs">
          {(Object.keys(SETS) as (keyof typeof SETS)[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={use[k]} onChange={() => toggle(k)} />
              {{ lower: "小写", upper: "大写", digit: "数字", symbol: "符号" }[k]}
            </label>
          ))}
        </div>
      </div>
      <Actions>
        <PrimaryBtn onClick={() => setPw(gen(len, use))}>生成密码</PrimaryBtn>
        <CopyBtn text={pw} />
      </Actions>
      <Out label="密码" value={pw} />
      {pw && (
        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 w-40 overflow-hidden rounded bg-neutral-200">
            <div
              className={`h-full ${strength.score >= 4 ? "bg-emerald-500" : strength.score >= 2 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${(strength.score / 5) * 100}%` }}
            />
          </div>
          <span className="text-neutral-600">强度：{strength.label}</span>
        </div>
      )}
    </div>
  );
}
