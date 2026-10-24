"use client";

/** UUID 生成：v4 随机，支持批量与 crypto 安全随机 */
import { useState } from "react";
import { Actions, Btn, CopyBtn, Input, NumInput, Out, PrimaryBtn } from "./_ui";

function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

export default function UuidGenerator() {
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [noDash, setNoDash] = useState(false);
  const [list, setList] = useState<string[]>([]);

  function gen(n: number) {
    const out = Array.from({ length: Math.max(1, Math.min(200, n)) }, () => {
      let u = uuidV4();
      if (noDash) u = u.replace(/-/g, "");
      return upper ? u.toUpperCase() : u;
    });
    setList(out);
  }

  return (
    <div className="max-w-[640px]">
      <Actions>
        <NumInput value={count} onChange={setCount} min={1} max={200} className="w-24" />
        <Btn onClick={() => setUpper((v) => !v)}>{upper ? "大写" : "小写"}</Btn>
        <Btn onClick={() => setNoDash((v) => !v)}>{noDash ? "无连字符" : "带连字符"}</Btn>
        <PrimaryBtn onClick={() => gen(count)}>生成 {count} 个</PrimaryBtn>
        {list.length > 0 && <CopyBtn text={list.join("\n")} label="复制全部" />}
      </Actions>
      <Out label={list.length ? `${list.length} 个 UUID` : "结果"} value={list.join("\n")} />
    </div>
  );
}
