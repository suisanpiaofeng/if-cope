"use client";

/** 百分比计算：X 的 Y% / 占比 / 变化率 / 折扣价，多场景一键算 */
import { useState } from "react";
import { Btn, NumInput } from "./_ui";

function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-100 py-2 text-sm last:border-b-0">
      <span className="w-44 shrink-0 text-neutral-500">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Val({ v }: { v: string }) {
  return <span className="num min-w-0 flex-1 font-mono text-neutral-900">{v}</span>;
}

export default function PercentageCalculator() {
  const [a, setA] = useState(200);
  const [b, setB] = useState(15);
  const [x, setX] = useState(80);
  const [y, setY] = useState(50);
  const [p, setP] = useState(25);
  const [off, setOff] = useState(30);

  const pct = (v: number) => (Number.isFinite(v) ? `${+v.toFixed(6)} %` : "—");
  const num = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(10)).toString() : "—");

  return (
    <div className="max-w-[560px]">
      <Line label={<>求 <NumInput value={a} onChange={setA} className="w-24" /> 的 <NumInput value={b} onChange={setB} className="w-20" />%</>}>
        <Val v={num((a * b) / 100)} />
      </Line>
      <Line label={<><NumInput value={x} onChange={setX} className="w-20" /> 占 <NumInput value={y} onChange={setY} className="w-20" /> 的百分之几</>}>
        <Val v={pct(y === 0 ? NaN : (x / y) * 100)} />
      </Line>
      <Line label={<><NumInput value={x} onChange={setX} className="w-20" /> → <NumInput value={y} onChange={setY} className="w-20" /> 变化率</>}>
        <Val v={pct(x === 0 ? NaN : ((y - x) / Math.abs(x)) * 100)} />
      </Line>
      <Line label={<><NumInput value={a} onChange={setA} className="w-24" /> 打 <NumInput value={off} onChange={setOff} className="w-16" /> 折（×{num(off / 10)}）</>}>
        <Val v={num((a * off) / 100)} />
      </Line>
      <Line label={<><NumInput value={a} onChange={setA} className="w-24" /> 减 <NumInput value={p} onChange={setP} className="w-20" />%</>}>
        <Val v={num(a * (1 - p / 100))} />
      </Line>
      <div className="mt-3 text-[11px] text-neutral-400">改任一输入框即时重算；折=原价×折数÷10。</div>
    </div>
  );
}
