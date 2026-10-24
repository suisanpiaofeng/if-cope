"use client";

/** Base32 / Base58 编解码：无第三方库实现（RFC4648 base32 + 比特币 base58） */
import { useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out, Select } from "./_ui";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

function b32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`非法 Base32 字符「${ch}」`);
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

function b58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  for (const b of bytes) { if (b === 0) zeros++; else break; }
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  return "1".repeat(zeros) + out;
}

function b58Decode(s: string): Uint8Array {
  let zeros = 0;
  for (const ch of s) { if (ch === "1") zeros++; else break; }
  let num = 0n;
  for (const ch of s) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error(`非法 Base58 字符「${ch}」`);
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) { bytes.unshift(Number(num % 256n)); num /= 256n; }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes]);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export default function Base3258() {
  const [mode, setMode] = useState<"b32" | "b58">("b58");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  function run(dir: "enc" | "dec") {
    setError("");
    try {
      if (dir === "enc") {
        setOutput(mode === "b32" ? b32Encode(enc.encode(input)) : b58Encode(enc.encode(input)));
      } else {
        const bytes = mode === "b32" ? b32Decode(input) : b58Decode(input);
        setOutput(dec.decode(bytes));
      }
    } catch (e) {
      setOutput("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="max-w-[640px]">
      <Actions>
        <Select label="算法" value={mode} onChange={setMode}
          options={[{ value: "b58", label: "Base58" }, { value: "b32", label: "Base32" }]} />
        <Btn onClick={() => run("enc")}>编码</Btn>
        <Btn onClick={() => run("dec")}>解码</Btn>
        <Btn onClick={() => { setInput(output); setOutput(""); }}>结果→输入</Btn>
        <CopyBtn text={output} />
      </Actions>
      <Area value={input} onChange={setInput} rows={6} mono placeholder="原文 / Base32 / Base58 串" />
      {error && <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <div className="mt-3"><Out label="输出" value={output} /></div>
    </div>
  );
}
