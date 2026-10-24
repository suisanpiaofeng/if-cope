"use client";

/** JSON ↔ TOML 互转（smol-toml），实时双向 + 校验 */
import { useMemo, useState } from "react";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

type Dir = "json2toml" | "toml2json";

export default function JsonToml() {
  const [dir, setDir] = useState<Dir>("json2toml");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const output = useMemo(() => {
    setError("");
    if (!input.trim()) return "";
    try {
      if (dir === "json2toml") return stringifyToml(JSON.parse(input));
      return JSON.stringify(parseToml(input), null, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  }, [input, dir]);

  return (
    <div className="max-w-[860px]">
      <Actions>
        <Select label="方向" value={dir} onChange={setDir}
          options={[{ value: "json2toml", label: "JSON → TOML" }, { value: "toml2json", label: "TOML → JSON" }]} />
        <Btn onClick={() => { setInput(output); setDir(dir === "json2toml" ? "toml2json" : "json2toml"); }}>结果→输入</Btn>
        <CopyBtn text={output} />
      </Actions>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2toml" ? "JSON 输入" : "TOML 输入"}</div>
          <Area value={input} onChange={setInput} rows={18} mono placeholder={dir === "json2toml" ? '{"输入": "JSON"}' : "# 输入 TOML"} />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2toml" ? "TOML 输出" : "JSON 输出"}</div>
          {error ? <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : <Out value={output} />}
        </div>
      </div>
    </div>
  );
}
