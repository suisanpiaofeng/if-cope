"use client";

/** 单位换算：长度/重量/温度/面积/体积/速度/数据/时间，实时双向 */
import { useEffect, useState } from "react";
import { Select } from "./_ui";

type Cat = { name: string; units: { key: string; label: string; toBase: number }[]; special?: "temp" };

const CATS: Cat[] = [
  { name: "长度", units: [
    { key: "m", label: "米 m", toBase: 1 }, { key: "km", label: "千米 km", toBase: 1000 },
    { key: "cm", label: "厘米 cm", toBase: 0.01 }, { key: "mm", label: "毫米 mm", toBase: 0.001 },
    { key: "mi", label: "英里 mi", toBase: 1609.344 }, { key: "ft", label: "英尺 ft", toBase: 0.3048 },
    { key: "in", label: "英寸 in", toBase: 0.0254 }, { key: "li", label: "里", toBase: 500 },
    { key: "chi", label: "尺", toBase: 1 / 3 },
  ]},
  { name: "重量", units: [
    { key: "kg", label: "千克 kg", toBase: 1 }, { key: "g", label: "克 g", toBase: 0.001 },
    { key: "t", label: "吨 t", toBase: 1000 }, { key: "lb", label: "磅 lb", toBase: 0.45359237 },
    { key: "oz", label: "盎司 oz", toBase: 0.028349523 }, { key: "jin", label: "斤", toBase: 0.5 },
  ]},
  { name: "温度", units: [
    { key: "c", label: "摄氏 °C", toBase: 1 }, { key: "f", label: "华氏 °F", toBase: 1 },
    { key: "k", label: "开尔文 K", toBase: 1 },
  ], special: "temp" },
  { name: "面积", units: [
    { key: "m2", label: "平方米", toBase: 1 }, { key: "km2", label: "平方千米", toBase: 1e6 },
    { key: "ha", label: "公顷", toBase: 1e4 }, { key: "mu", label: "亩", toBase: 666.667 },
    { key: "ft2", label: "平方英尺", toBase: 0.09290304 },
  ]},
  { name: "体积", units: [
    { key: "l", label: "升 L", toBase: 1 }, { key: "ml", label: "毫升 mL", toBase: 0.001 },
    { key: "m3", label: "立方米", toBase: 1000 }, { key: "gal", label: "加仑(美)", toBase: 3.785411784 },
  ]},
  { name: "速度", units: [
    { key: "ms", label: "米/秒", toBase: 1 }, { key: "kmh", label: "千米/时", toBase: 1 / 3.6 },
    { key: "mph", label: "英里/时", toBase: 0.44704 }, { key: "mach", label: "马赫", toBase: 340.3 },
  ]},
  { name: "数据", units: [
    { key: "b", label: "字节 B", toBase: 1 }, { key: "kb", label: "KB", toBase: 1024 },
    { key: "mb", label: "MB", toBase: 1048576 }, { key: "gb", label: "GB", toBase: 1073741824 },
    { key: "tb", label: "TB", toBase: 1099511627776 },
  ]},
  { name: "时间", units: [
    { key: "s", label: "秒", toBase: 1 }, { key: "min", label: "分钟", toBase: 60 },
    { key: "h", label: "小时", toBase: 3600 }, { key: "d", label: "天", toBase: 86400 },
    { key: "week", label: "周", toBase: 604800 },
  ]},
];

function tempToC(v: number, from: string) {
  if (from === "c") return v;
  if (from === "f") return (v - 32) * 5 / 9;
  return v - 273.15; // k
}
function tempFromC(v: number, to: string) {
  if (to === "c") return v;
  if (to === "f") return v * 9 / 5 + 32;
  return v + 273.15;
}

export default function UnitConverter() {
  const [catIdx, setCatIdx] = useState(0);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(1);
  const [value, setValue] = useState("");

  const cat = CATS[catIdx];
  const fromU = cat.units[from];
  const toU = cat.units[to];

  useEffect(() => { setFrom(0); setTo(Math.min(1, cat.units.length - 1)); }, [catIdx]);

  const num = Number(value);
  const result = (() => {
    if (!Number.isFinite(num)) return "（无效数字）";
    if (cat.special === "temp") {
      return fmt(tempFromC(tempToC(num, fromU.key), toU.key));
    }
    const base = num * fromU.toBase;
    return fmt(base / toU.toBase);
  })();

  function calc(v: number, a: typeof from, b: typeof to): string {
    const A = cat.units[a], B = cat.units[b];
    if (!Number.isFinite(v)) return "";
    if (cat.special === "temp") return fmt(tempFromC(tempToC(v, A.key), B.key));
    return fmt((v * A.toBase) / B.toBase);
  }

  return (
    <div className="max-w-[560px] space-y-4">
      <div className="flex items-center gap-2">
        <Select label="类别" value={String(catIdx)} onChange={(v: string) => setCatIdx(Number(v))}
          options={CATS.map((c, i) => ({ value: String(i), label: c.name }))} />
      </div>

      <div className="flex items-center gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-200 px-3 py-2 font-mono text-lg outline-none focus:border-neutral-400" />
        <Select value={String(from)} onChange={(v: string) => setFrom(Number(v))}
          options={cat.units.map((u, i) => ({ value: String(i), label: u.label }))} />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => { const a = from, b = to; setFrom(b); setTo(a); }}
          title="交换单位"
          className="border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-50">⇅ 交换</button>
        <div className="min-w-0 flex-1 truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-lg text-neutral-800">
          {result}
        </div>
        <Select value={String(to)} onChange={(v: string) => setTo(Number(v))}
          options={cat.units.map((u, i) => ({ value: String(i), label: u.label }))} />
      </div>

      <div className="border border-neutral-200">
        {cat.units.map((u, i) => (
          <div key={u.key} className={`flex items-center justify-between px-3 py-1.5 text-xs ${i ? "border-t border-neutral-100" : ""} ${i === to ? "bg-neutral-50" : ""}`}>
            <span className="text-neutral-500">{u.label}</span>
            <button onClick={() => { setValue(String(num)); setTo(i); }}
              className="num font-mono text-neutral-800 hover:text-neutral-900" title="设为目标单位">
              {calc(num, from, i) || "—"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0) ? n.toExponential(6) : Number(n.toPrecision(10)).toString();
  return r;
}
