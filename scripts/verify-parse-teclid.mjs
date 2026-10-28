// parseTeclId 验证（T3；规格 §4 登记课程解析明文 teclId）
// 运行：node scripts/verify-parse-teclid.mjs
import assert from "node:assert/strict";
import { parseTeclId } from "../src/lib/classroom/cvsApi.ts";

// 明文 teclId query 参数
assert.equal(parseTeclId("https://cvs.seu.edu.cn/xxx?teclId=ABC123&y=1"), "ABC123");
// 无协议也能解析
assert.equal(parseTeclId("cvs.seu.edu.cn/xxx?teclId=ZZZ"), "ZZZ");
// 加密分享链接（无明文 teclId）→ null（提示用户复制明文链接）
assert.equal(parseTeclId("https://cvs.seu.edu.cn/xxx?mko2GSd8f3K==&sig=1"), null);
// 完全无关链接 → null
assert.equal(parseTeclId("https://example.com/"), null);
// 空串 → null
assert.equal(parseTeclId(""), null);

console.log("PASS: parseTeclId 全部断言通过");
