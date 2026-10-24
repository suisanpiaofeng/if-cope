"use client";

/**
 * 工具库共享 UI 原语（仅客户端）。统一中性灰风格，避免 20+ 工具重复样板。
 * 依赖 React 与 Tailwind，无任何第三方库。
 */
import { useEffect, useRef, useState } from "react";

export function Btn({ onClick, disabled, children, title }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40">
      {children}
    </button>
  );
}

export function PrimaryBtn({ onClick, disabled, children }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="border border-neutral-900 bg-neutral-900 px-4 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40">
      {children}
    </button>
  );
}

/** 一键复制，短暂显示「已复制」 */
export function CopyBtn({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      disabled={!text}
    >
      {done ? "已复制" : label}
    </Btn>
  );
}

export function Input({ value, onChange, placeholder, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 ${mono ? "font-mono" : ""}`}
    />
  );
}

export function Area({ value, onChange, placeholder, rows = 8, mono, readOnly }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean; readOnly?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      readOnly={readOnly}
      rows={rows}
      className={`w-full resize-y rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400 ${
        mono ? "font-mono text-xs" : ""
      } ${readOnly ? "bg-neutral-50" : ""}`}
    />
  );
}

/** 只读输出区（等宽、灰底），带标题与可选复制 */
export function Out({ label, value, children }: {
  label?: string; value?: string; children?: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">{label}</span>
          {value !== undefined && <CopyBtn text={value} />}
        </div>
      )}
      {children ?? (
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-800">
          {value || "（空）"}
        </pre>
      )}
    </div>
  );
}

/** 一组横向按钮（工具动作条） */
export function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

/** 单选下拉 */
export function Select<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-700">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** 提示块 */
export function Hint({ text }: { text: string }) {
  return <div className="mt-2 text-[11px] text-neutral-400">{text}</div>;
}

export function ErrBox({ msg }: { msg: string }) {
  return <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{msg}</div>;
}

/** 数字输入（受控，返回 number） */
export function NumInput({ value, onChange, min, max, step, className }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-400 ${className ?? ""}`}
    />
  );
}

/** 仅 client 挂载后为 true（规避 SSR/hydration 读 localStorage 等） */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** 用于「结果→输入」这类搬运，返回一个受控输入的清空句柄 */
export function useResetKey(): [number, () => void] {
  const [k, setK] = useState(0);
  return [k, () => setK((x) => x + 1)];
}

export function useTimeoutFlag(ms = 1200): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(null);
  const fire = () => {
    setOn(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setOn(false), ms);
  };
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [on, fire];
}
