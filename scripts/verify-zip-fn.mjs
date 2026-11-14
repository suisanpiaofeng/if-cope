// zip 打包验证（计划 P2 T2：CRC32 已知值/结构签名/条目数/明文可寻）
// 运行：node scripts/verify-zip-fn.mjs
import assert from "node:assert/strict";
const { crc32, buildZip } = await import("../src/lib/agent/zip.ts");

// 1. CRC32 标准已知值
assert.equal(crc32("hello"), 0x3610a686);
assert.equal(crc32(""), 0);
assert.equal(crc32("a"), 0xe8b7be43);

// 2. 单条目：local header 签名 / stored 明文 / EOCD 条目数
const zip1 = buildZip([{ path: "a.txt", content: "hello" }]);
assert.equal(zip1.readUInt32LE(0), 0x04034b50, "local header 签名");
assert.ok(zip1.includes(Buffer.from("hello")), "stored 无压缩，内容明文可寻");
const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const idx1 = zip1.lastIndexOf(EOCD);
assert.ok(idx1 > 0, "应有 EOCD");
assert.equal(zip1.readUInt16LE(idx1 + 10), 1, "EOCD 条目数=1");

// 3. 多条目 + 目录路径 + 中央目录签名
const zip2 = buildZip([
  { path: "d/x.txt", content: "1" },
  { path: "d/y.txt", content: "2" },
]);
assert.ok(zip2.includes(Buffer.from("d/x.txt")) && zip2.includes(Buffer.from("d/y.txt")));
assert.ok(zip2.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), "中央目录签名");
const idx2 = zip2.lastIndexOf(EOCD);
assert.equal(zip2.readUInt16LE(idx2 + 10), 2, "EOCD 条目数=2");

// 4. 空条目列表也能产出合法骨架
const zip3 = buildZip([]);
assert.equal(zip3.readUInt32LE(zip3.lastIndexOf(EOCD)), 0x06054b50);

console.log("verify-zip-fn: OK");
