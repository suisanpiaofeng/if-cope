"use client";

/** JSON 转代码：TS interface / Go struct / Python / Java POJO / C# class / SQL 建表 */
import { useMemo, useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

type Target = "ts" | "go" | "py" | "java" | "csharp" | "sql";

/** 生成类/接口的根名（模块常量，避免组件内 TDZ） */
const ROOT = "Root";

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) + (s.length > 1 ? s.slice(1) : ""); }
function snake(s: string) { return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(); }
function safeKey(k: string) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k); }

function tsType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `${tsType(v[0])}[]` : "unknown[]";
  if (typeof v === "object") return "unknown";
  return typeof v;
}
function inferTs(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    const inner = v.length ? inferTs(v[0], depth + 1) : "unknown";
    return `${inner}[]`;
  }
  if (typeof v === "object") {
    if (depth > 6) return "Record<string, unknown>";
    const entries = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `  ${safeKey(k)}?: ${inferTs(val, depth + 1)};`).join("\n");
    return `{\n${entries}\n}`;
  }
  return typeof v;
}

function goType(v: unknown, depth = 0): string {
  if (v === null) return "interface{}";
  if (Array.isArray(v)) return `[]${v.length ? goType(v[0], depth + 1) : "interface{}"}`;
  if (typeof v === "object") return "struct";
  switch (typeof v) {
    case "string": return "string";
    case "number": return Number.isInteger(v) ? "int" : "float64";
    case "boolean": return "bool";
    default: return "interface{}";
  }
}

export default function JsonToCode() {
  const [target, setTarget] = useState<Target>("ts");
  const [input, setInput] = useState('{\n  "id": 1,\n  "name": "IF.Cope",\n  "enabled": true,\n  "score": 95.5,\n  "tags": ["学习", "AI"],\n  "owner": { "uid": 1001, "email": "a@b.com" }\n}');
  const [error, setError] = useState("");

  const out = useMemo(() => {
    setError("");
    if (!input.trim()) return "";
    try {
      let data = JSON.parse(input);
      if (Array.isArray(data)) data = data[0];
      if (typeof data !== "object" || data === null) throw new Error("需要对象或对象数组");
      return convert(target, data as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  }, [input, target]);

  function convert(t: Target, obj: Record<string, unknown>): string {
    if (t === "ts") {
      return `interface ${ROOT} ${inferTs(obj)}`;
    }
    if (t === "go") {
      const fields = Object.entries(obj).map(([k, v]) => {
        const gt = goType(v);
        return gt === "struct"
          ? `  ${cap(k)} ${cap(k)} \`json:"${k}"\``
          : `  ${cap(k)} ${gt} \`json:"${k}"\``;
      }).join("\n");
      // 内嵌对象递归
      const nested = Object.entries(obj)
        .filter(([, v]) => isPlainObj(v))
        .map(([k, v]) => `type ${cap(k)} struct {\n${Object.entries(v as object).map(([kk, vv]) => `  ${cap(kk)} ${goType(vv)} \`json:"${kk}"\``).join("\n")}\n}`).join("\n\n");
      return `type ${ROOT} struct {\n${fields}\n}\n\n${nested}`;
    }
    if (t === "py") {
      const lines = [`class ${ROOT}:`, `    def __init__(self):`];
      for (const [k, v] of Object.entries(obj)) lines.push(`        self.${snake(k)} = ${pyVal(v)}`);
      return lines.join("\n");
    }
    if (t === "java" || t === "csharp") {
      const lang = t === "java" ? "java" : "csharp";
      const fields = Object.entries(obj).map(([k, v]) => {
        const ty = javaType(v, lang);
        const decl = lang === "java" ? `private ${ty} ${k};` : `public ${ty} ${cap(k)} { get; set; }`;
        return `    ${decl}`;
      }).join("\n\n");
      const getters = lang === "java"
        ? "\n\n" + Object.entries(obj).map(([k, v]) => `    public ${javaType(v, "java")} get${cap(k)}() { return ${k}; }\n    public void set${cap(k)}(${javaType(v, "java")} ${k}) { this.${k} = ${k}; }`).join("\n")
        : "";
      return `public class ${ROOT} {\n${fields}${getters}\n}`;
    }
    // sql
    const cols = Object.entries(obj).map(([k, v]) => `  ${snake(k)} ${sqlType(v)}${k === "id" ? " PRIMARY KEY" : ""}`).join(",\n");
    return `CREATE TABLE ${snake(ROOT)} (\n${cols}\n);`;
  }

  return (
    <div className="max-w-[860px]">
      <Actions>
        <Select label="目标" value={target} onChange={setTarget}
          options={[
            { value: "ts", label: "TypeScript" }, { value: "go", label: "Go struct" },
            { value: "py", label: "Python" }, { value: "java", label: "Java" },
            { value: "csharp", label: "C#" }, { value: "sql", label: "SQL 建表" },
          ]} />
        <CopyBtn text={out} />
      </Actions>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">JSON 输入</div>
          <Area value={input} onChange={setInput} rows={20} mono />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-neutral-400">生成代码</div>
          {error ? <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : <Out value={out} />}
        </div>
      </div>
    </div>
  );
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function pyVal(v: unknown): string {
  if (v === null) return "None";
  if (Array.isArray(v)) return `[${v.map(pyVal).join(", ")}]`;
  if (typeof v === "object") return "{...}";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
function javaType(v: unknown, lang: "java" | "csharp"): string {
  if (Array.isArray(v)) return lang === "java" ? "List<Object>" : "List<object>";
  if (isPlainObj(v)) return "Map<String, Object>";
  if (v === null) return lang === "java" ? "Object" : "object";
  switch (typeof v) {
    case "string": return "String";
    case "number": return Number.isInteger(v) ? (lang === "java" ? "Long" : "long") : (lang === "java" ? "Double" : "double");
    case "boolean": return lang === "java" ? "Boolean" : "bool";
    default: return "Object";
  }
}
function sqlType(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
  if (typeof v === "boolean") return "BOOLEAN";
  if (Array.isArray(v) || isPlainObj(v)) return "JSON";
  return "TEXT";
}
