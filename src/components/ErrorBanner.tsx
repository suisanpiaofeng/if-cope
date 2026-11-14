"use client";

/** 统一错误条（harness P1 §7.4）：五类错误分类色/图标/建议文案 */
import { classifyError, friendlyError, type ErrorKind } from "@/lib/agent/errors";

const KIND_STYLE: Record<ErrorKind, string> = {
  network: "border-blue-200 bg-blue-50 text-blue-800",
  timeout: "border-amber-200 bg-amber-50 text-amber-800",
  validation: "border-red-200 bg-red-50 text-red-800",
  denied: "border-purple-200 bg-purple-50 text-purple-800",
  unknown: "border-neutral-200 bg-neutral-50 text-neutral-700",
};

const KIND_ICON: Record<ErrorKind, string> = {
  network: "🌐",
  timeout: "⏱",
  validation: "⚠",
  denied: "🚫",
  unknown: "✕",
};

export default function ErrorBanner({ message, kind }: { message: string; kind?: ErrorKind }) {
  if (!message) return null;
  const k = kind ?? classifyError(message);
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${KIND_STYLE[k]}`}>
      <span className="mr-1">{KIND_ICON[k]}</span>
      {friendlyError(k, message)}
    </div>
  );
}
