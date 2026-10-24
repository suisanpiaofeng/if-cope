"use client";

/** 随机数 / 随机整数 / 抽签：crypto 安全，含区间与去重 */
import { useState } from "react";
import { Actions, Btn, CopyBtn, NumInput, Out, PrimaryBtn } from "./_ui";

export default function RandomNumber() {
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [count, setCount] = useState(1);
  const [unique, setUnique] = useState(false);
  const [out, setOut] = useState<number[]>([]);

  function gen() {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    const span = hi - lo + 1;
    if (span <= 0) return setOut([]);
    const n = Math.max(1, Math.min(unique ? span : 1000, count));
    if (unique && count > span) {
      // 去重模式下数量不得超过区间大小
      setOut(shuffleRange(lo, hi).slice(0, count));
      return;
    }
    const rnd = crypto.getRandomValues(new Uint32Array(n));
    setOut([...rnd].map((r) => lo + (r % span)));
  }

  return (
    <div className="max-w-[560px] space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>最小</span><NumInput value={min} onChange={setMin} className="w-24" />
        <span>最大</span><NumInput value={max} onChange={setMax} className="w-24" />
        <span>个数</span><NumInput value={count} onChange={setCount} min={1} max={1000} className="w-24" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={unique} onChange={() => setUnique((v) => !v)} /> 不重复（抽签）
        </label>
      </div>
      <Actions>
        <PrimaryBtn onClick={gen}>生成随机数</PrimaryBtn>
        <CopyBtn text={out.join(", ")} />
      </Actions>
      <Out label="结果" value={out.join(", ")} />
    </div>
  );
}

/** 区间洗牌（Fisher-Yates），用于不重复抽样 */
function shuffleRange(lo: number, hi: number): number[] {
  const arr = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const rnd = crypto.getRandomValues(new Uint32Array(arr.length));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
