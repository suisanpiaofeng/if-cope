"use client";

/** JSON ↔ YAML 互转（js-yaml），实时双向 + 校验 */
import { useMemo, useState } from "react";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

type Dir = "json2yaml" | "yaml2json";

export default function JsonYaml() {
  const [dir, setDir] = useState<Dir>("json2yaml");
  const [input, setInput] = useState('{\n  "name": "IF.Cope",\n  "tools": 28,\n  "tags": ["学习", "AI"]\n}');
  const [error, setError] = useState("");

  const output = useMemo(() => {
    setError("");
    if (!input.trim()) return "";
    try {
      if (dir === "json2yaml") {
        return yamlDump(JSON.parse(input), { indent: 2, lineWidth: 100, noRefs: true });
      }
      return JSON.stringify(yamlLoad(input), null, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  }, [input, dir]);

  const placeholder = dir === "json2yaml" ? '{"输入": "JSON"}' : "# 输入 YAML";

  return (
    <div className="max-w-[860px]">
      <Actions>
        <Select label="方向" value={dir} onChange={setDir}
          options={[{ value: "json2yaml", label: "JSON → YAML" }, { value: "yaml2json", label: "YAML → JSON" }]} />
        <Btn onClick={() => { setInput(output); setDir(dir === "json2yaml" ? "yaml2json" : "json2yaml"); }}>结果→输入</Btn>
        <CopyBtn text={output} />
      </Actions>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2yaml" ? "JSON 输入" : "YAML 输入"}</div>
          <Area value={input} onChange={setInput} rows={18} mono placeholder={placeholder} />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">{dir === "json2yaml" ? "YAML 输出" : "JSON 输出"}</div>
          {error ? <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : <Out value={output} />}
        </div>
      </div>
    </div>
  );
}
