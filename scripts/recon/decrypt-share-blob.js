#!/usr/bin/env node
/**
 * CVS 加密分享链接解密（真机验证 2026-11-10）：
 * 官方新分享链接是 #/play-center?mko2GS… 加密 blob，本工具解出明文参数（teclId/teclCode/subjId 等）。
 * 原理：SPA chunk 44797 的 AES-128-CBC（key=jy-resource-qry1, iv=jy-query-iv-0001, __encrypted_query__: 前缀）。
 * 用法：node scripts/recon/decrypt-share-blob.js <blob文件>（blob 行 = mko2GS… 整串，可 URL 编码）。
 * 注意：解密结果可能含登录 JWT——只在本机查看，勿写入任何文档/仓库。
 */
const crypto = require("crypto");
const fs = require("fs");

let blob = fs.readFileSync(process.argv[2], "utf8").trim();
try {
  blob = decodeURIComponent(blob);
} catch {}
const key = Buffer.from("jy-resource-qry1", "utf8");
const iv = Buffer.from("jy-query-iv-0001", "utf8");
try {
  const dec = crypto.createDecipheriv("aes-128-cbc", key, iv);
  let out = dec.update(Buffer.from(blob, "base64"));
  out = Buffer.concat([out, dec.final()]);
  console.log("解密结果:", out.toString("utf8"));
} catch (e) {
  console.log("解密失败:", e.message);
}
