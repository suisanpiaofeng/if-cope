"use client";

/** 二维码生成：文本 / 链接 → PNG 二维码（qrcode 纯前端生成） */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QrCode() {
  const [text, setText] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!text.trim()) {
      setDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(text, { width: 320, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div className="flex max-w-[720px] gap-6">
      <div className="flex-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入文本或链接…"
          className="h-[180px] w-full resize-none rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
        />
        {error && <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="mt-2 text-[11px] text-neutral-400">二维码随输入实时更新 · 右键图片可直接保存</div>
      </div>
      <div className="flex w-[280px] shrink-0 flex-col items-center">
        {dataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="二维码" className="border border-neutral-200" />
            <a
              href={dataUrl}
              download="qrcode.png"
              className="mt-3 border border-neutral-300 px-4 py-1.5 text-xs hover:bg-neutral-50"
            >
              下载 PNG
            </a>
          </>
        ) : (
          <div className="flex h-[280px] w-[280px] items-center justify-center border border-dashed border-neutral-200 text-xs text-neutral-400">
            输入内容后生成
          </div>
        )}
      </div>
    </div>
  );
}
