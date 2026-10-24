/**
 * postinstall 裁剪：删掉重依赖里永远用不到的发行产物（约省 60MB+）。
 * - mermaid：只保留 ESM（Next 打包走 module/exports 入口），删 UMD bundle 与全部 sourcemap
 * 防御式：先核对 package.json 的入口没被删，避免上游改入口后误伤。
 */
import { rmSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const nm = path.join(process.cwd(), "node_modules");
let saved = 0;

function fileSize(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

function safeRemove(root, rel) {
  const p = path.join(root, rel);
  if (!existsSync(p)) return;
  saved += fileSize(p);
  rmSync(p, { force: true });
}

/** 收集 package.json 里所有入口引用的文件名，用于防误删 */
function entryFiles(pkgJsonPath) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const names = new Set();
    const walk = (v) => {
      if (typeof v === "string") names.add(path.basename(v));
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(pkg.main);
    walk(pkg.module);
    walk(pkg.exports);
    walk(pkg.browser);
    return names;
  } catch {
    return null;
  }
}

/** 递归删掉目录下所有 *.map（sourcemap 只影响调试，不影响运行） */
function stripMaps(dir, entries) {
  for (const name of entries) {
    const p = path.join(dir, name);
    if (name.endsWith(".map")) {
      saved += fileSize(p);
      rmSync(p, { force: true });
    } else if (statSync(p).isDirectory()) {
      stripMaps(p, readdirSync(p));
    }
  }
}

// ── mermaid：删 UMD bundle + 全部 sourcemap，只留 ESM ──
const mermaidDist = path.join(nm, "mermaid", "dist");
if (existsSync(mermaidDist)) {
  const entries = entryFiles(path.join(nm, "mermaid", "package.json")) ?? new Set();
  for (const f of ["mermaid.js", "mermaid.min.js", "mermaid.esm.mjs", "mermaid.esm.min.mjs", "mermaid.core.mjs"]) {
    if (entries.has(f)) continue; // 入口文件，不删
    safeRemove(mermaidDist, f);
  }
  stripMaps(mermaidDist, readdirSync(mermaidDist));
}

// ── js-yaml / smol-toml：只删 sourcemap（.map 不参与运行，浏览器构建保留不误伤 webpack 解析）──
for (const pkg of ["js-yaml", "smol-toml"]) {
  const dir = path.join(nm, pkg);
  if (existsSync(dir)) stripMaps(dir, readdirSync(dir));
}

if (saved > 0) {
  console.log(`[trim-heavy-deps] 已裁剪无用发行产物，释放 ${(saved / 1024 / 1024).toFixed(0)} MB`);
}
