"use client";

/** Base64 文件转换：文件→Base64 / Base64→文件，本地处理不上传 */
import { useRef, useState } from "react";
import { Actions, Area, Btn, CopyBtn, Hint } from "./_ui";

type Done = { b64: string; name: string; size: number; mime: string };

export default function Base64File() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<Done | null>(null);
  const [text, setText] = useState("");
  const [outUrl, setOutUrl] = useState("");
  const [outName, setOutName] = useState("");
  const [error, setError] = useState("");

  async function onPick(f: File | undefined) {
    if (!f) return;
    setError("");
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    setFile({ b64: btoa(bin), name: f.name, size: f.size, mime: f.type || "application/octet-stream" });
  }

  function b64ToFiles() {
    setError("");
    try {
      const clean = text.trim().replace(/^data:[^,]+,/, "");
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mimeMatch = text.trim().match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const blob = new Blob([bytes], { type: mime });
      if (outUrl) URL.revokeObjectURL(outUrl);
      const ext = mime.split("/")[1]?.split("+")[0] || "bin";
      setOutUrl(URL.createObjectURL(blob));
      setOutName(`decoded.${ext}`);
    } catch (e) {
      setError(`解码失败：${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="max-w-[720px] space-y-6">
      <div>
        <div className="mb-2 text-sm font-semibold">文件 → Base64</div>
        <input ref={fileRef} type="file" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}
          className="border border-dashed border-neutral-300 px-4 py-3 text-xs text-neutral-500 hover:border-neutral-500">
          选择文件（本地转换，不上传）
        </button>
        {file && (
          <div className="mt-2">
            <div className="mb-1 text-xs text-neutral-600">
              {file.name} · <span className="num">{(file.size / 1024).toFixed(1)} KB</span> · {file.mime}
              <span className="ml-2 text-neutral-400">Base64 长度 <span className="num">{file.b64.length}</span></span>
            </div>
            <Area value={file.b64} rows={6} readOnly mono />
            <div className="mt-2"><CopyBtn text={file.b64} label="复制 Base64" /></div>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <div className="mb-2 text-sm font-semibold">Base64 → 文件</div>
        <Area value={text} onChange={setText} rows={6} mono
          placeholder="粘贴 Base64 串（支持 data:...;base64, 前缀）" />
        <Actions>
          <Btn onClick={b64ToFiles} disabled={!text.trim()}>解码为文件</Btn>
          {outUrl && (
            <a href={outUrl} download={outName}
              className="border border-emerald-600 px-4 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">
              下载 {outName}
            </a>
          )}
        </Actions>
        {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      </div>
      <Hint text="大文件转 Base64 会占用较多内存；日常建议只处理小文件（<10MB）。" />
    </div>
  );
}
