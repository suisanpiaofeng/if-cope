"use client";

/** 编解码：Base64（UTF-8 安全）+ URL 编解码 */
import { useState } from "react";

function b64encode(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function b64decode(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0)));
}

function CodecRow({ title, enc, dec, placeholder }: {
  title: string;
  enc: (s: string) => string;
  dec: (s: string) => string;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  function run(mode: "enc" | "dec") {
    try {
      setOutput(mode === "enc" ? enc(input) : dec(input));
      setError("");
    } catch (e) {
      setOutput("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="border border-neutral-200 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <button onClick={() => run("enc")} className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">编码</button>
        <button onClick={() => run("dec")} className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">解码</button>
        <button
          onClick={() => { setInput(output); setOutput(""); }}
          className="border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
          title="把输出搬到输入，再编码一次"
        >结果→输入</button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        className="h-[120px] w-full resize-none rounded-md border border-neutral-200 p-2.5 font-mono text-xs outline-none focus:border-neutral-400"
      />
      {error && <div className="mt-2 border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">出错：{error}</div>}
      <textarea
        value={output}
        readOnly
        placeholder="输出区"
        className="mt-2 h-[120px] w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-2.5 font-mono text-xs outline-none"
      />
    </div>
  );
}

export default function CodecTools() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CodecRow title="Base64" enc={b64encode} dec={b64decode} placeholder="原文 / Base64 串" />
      <CodecRow title="URL" enc={encodeURIComponent} dec={decodeURIComponent} placeholder="原文 / URL 编码串" />
    </div>
  );
}
