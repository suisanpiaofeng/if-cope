// 一次性侦察脚本：在下载的官方 SPA chunk 里定位 API 定义与调用上下文
const fs = require("fs");
const path = require("path");
const DIR = process.argv[2] || "/tmp/cvs-recon";
const file = process.argv[3];
const apiPath = process.argv[4];
const src = fs.readFileSync(path.join(DIR, file), "utf8");

const esc = "\\/?" + apiPath.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);

// function xx(e){return M.A.ajax(N.A.getBaseUrl()+"/v1/...", "get", e)}
const defRe = new RegExp(
  "function (\\w+)\\(\\w*\\)\\{return [\\w$]{1,3}\\.A\\.ajax\\([\\w$]{1,3}\\.A\\.getBaseUrl\\(\\)\\+\"" + esc,
  "g"
);
const names = [...src.matchAll(defRe)].map((m) => m[1]);
console.log("定义名:", names);

for (const name of names) {
  const callRe = new RegExp("\\(0,[\\w$]{1,3}\\." + name + "\\)\\(", "g");
  let n = 0;
  for (const c of src.matchAll(callRe)) {
    const k = c.index;
    console.log("--- 调用处 @" + k + " ---");
    console.log(src.slice(Math.max(0, k - 320), k + 340));
    console.log();
    if (++n >= 4) break;
  }
}
if (!names.length) {
  const i = src.indexOf(apiPath);
  console.log("未匹配函数定义，直接上下文：");
  console.log(src.slice(Math.max(0, i - 300), i + 300));
}
