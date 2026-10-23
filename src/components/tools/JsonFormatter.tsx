"use client";

/** JSON 格式化：格式化（2 空格）/ 压缩 / 校验 */
import { useState } from "react";

export default function JsonFormatter() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  function run(mode: "format" | "minify" | "validate") {
    setError("");
    try {
      const parsed = JSON.parse(input);
      if (mode === "validate") {
        setOutput("✅ 合法 JSON");
      } else if (mode === "format") {
        setOutput(JSON.stringify(parsed, null, 2));
      } else {
        setOutput(JSON.stringify(parsed));
      }
    } catch (e) {
      setOutput("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button onClick={() => run("format")} className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">格式化</button>
        <button onClick={() => run("minify")} className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">压缩</button>
        <button onClick={() => run("validate")} className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">校验</button>
        <button onClick={() => { setInput(""); setOutput(""); setError(""); }}
          className="ml-auto border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">清空</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='{"输入": "JSON"}'
          className="h-[380px] w-full resize-none rounded-md border border-neutral-200 p-3 font-mono text-xs outline-none focus:border-neutral-400"
        />
        <div className="flex flex-col">
          {error ? (
            <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          ) : null}
          <textarea
            value={output}
            readOnly
            placeholder="输出区"
            className="h-[380px] w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs outline-none"
          />
        </div>
      </div>
    </div>
  );
}
