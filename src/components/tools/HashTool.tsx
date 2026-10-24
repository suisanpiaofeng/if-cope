"use client";

/** Hash / HMAC：Web Crypto 实现 SHA-1/256/384/512，文本或文件输入 */
import { useEffect, useRef, useState } from "react";
import { Actions, Area, CopyBtn, Hint, Out, Select } from "./_ui";

const HASH_ALGS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
type HashAlg = (typeof HASH_ALGS)[number];
const enc = new TextEncoder();

async function digest(alg: HashAlg, data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data.slice().buffer : data;
  const d = await crypto.subtle.digest(alg, buf as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(alg: HashAlg, key: string, data: string): Promise<string> {
  const subtleAlg = alg.replace("SHA-", "SHA-");
  const ck = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: subtleAlg }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function HashTool() {
  const [text, setText] = useState("");
  const [alg, setAlg] = useState<HashAlg>("SHA-256");
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [hmacKey, setHmacKey] = useState("");
  const [hmacOut, setHmacOut] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileHashes, setFileHashes] = useState<Record<string, string>>({});

  // 文本变化实时算全部哈希
  useEffect(() => {
    let cancel = false;
    const data = enc.encode(text);
    Promise.all(HASH_ALGS.map((a) => digest(a, data).then((h) => [a, h] as const)))
      .then((pairs) => { if (!cancel) setHashes(Object.fromEntries(pairs)); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [text]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name); setFileSize(f.size);
    const buf = await f.arrayBuffer();
    const pairs = await Promise.all(HASH_ALGS.map((a) => digest(a, buf).then((h) => [a, h] as const)));
    setFileHashes(Object.fromEntries(pairs));
  }

  return (
    <div className="max-w-[720px] space-y-5">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">文本内容</span>
          <Select label="算法" value={alg} onChange={setAlg}
            options={HASH_ALGS.map((a) => ({ value: a, label: a }))} />
        </div>
        <Area value={text} onChange={setText} rows={6} mono placeholder="输入任意文本，实时计算各算法哈希" />
      </div>

      <div className="space-y-1">
        {HASH_ALGS.map((a) => (
          <Out key={a} label={a} value={hashes[a] ?? ""} />
        ))}
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <div className="mb-2 text-sm font-semibold">HMAC（密钥消息认证码）</div>
        <div className="flex gap-2">
          <input value={hmacKey} onChange={(e) => setHmacKey(e.target.value)} placeholder="密钥 key"
            className="w-48 rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-400" />
          <button onClick={() => hmac(alg, hmacKey, text).then(setHmacOut)} disabled={!hmacKey}
            className="border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40">
            用 {alg} 计算 HMAC
          </button>
        </div>
        {hmacOut && <div className="mt-2"><Out label="HMAC" value={hmacOut} /></div>}
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <div className="mb-2 text-sm font-semibold">文件哈希（本地计算，不上传）</div>
        <input ref={fileRef} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}
          className="border border-dashed border-neutral-300 px-4 py-3 text-xs text-neutral-500 hover:border-neutral-500">
          选择文件计算 SHA-1/256/384/512
        </button>
        {fileName && (
          <div className="mt-2">
            <div className="mb-1 text-xs text-neutral-600">
              {fileName} · <span className="num">{(fileSize / 1024).toFixed(1)} KB</span>
            </div>
            {HASH_ALGS.map((a) => <Out key={a} label={a} value={fileHashes[a] ?? ""} />)}
          </div>
        )}
        <Hint text="Web Crypto 不支持 MD5；如需 MD5 可后续单独引入轻量实现。" />
      </div>
    </div>
  );
}
