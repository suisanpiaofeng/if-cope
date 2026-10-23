/**
 * PDF 保真翻译（文献翻译 PDF 通道）：
 * 调用开源项目 PDFMathTranslate（pdf2zh，37k★，EMNLP 2025）本地 CLI，
 * 完整保留排版生成 双语对照/纯译文 两份 PDF；翻译上游用我们的「翻译模型独立接口」。
 *
 * 依赖：`uv tool install --python 3.12 pdf2zh`（可执行文件在 ~/.local/bin/pdf2zh）。
 * 已知上游坑（本机已修，装机时如复现照做）：
 *  - tencentcloud-sdk-python-tmt 需钉 3.0.1478（新版缺 TextTranslateRequest）
 *  - bitstring 需钉 4.3.1（5.0 删了 BitStream，babeldoc 导入报错）
 */
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import db, { getAigcCategoryId } from "./db";
import { translateUpstream } from "./translate";
import type { PdfTranslationDoc } from "./types";

const TRANSLATIONS_DIR = path.join(process.cwd(), "data", "translations");
const RUN_TIMEOUT_MS = 280_000; // 300s 路由上限留出开销

function pdf2zhBin(): string {
  const exe = process.platform === "win32" ? "pdf2zh.exe" : "pdf2zh";
  return path.join(os.homedir(), ".local", "bin", exe);
}

/** 产物里存的相对路径 → 绝对路径（规范化后必须仍在 data/translations 内，防穿越） */
export function resolveTranslatedPath(rel: string): string | null {
  const normalized = path.normalize(rel).replace(/^([/\\])+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const p = path.join(TRANSLATIONS_DIR, normalized);
  if (!p.startsWith(TRANSLATIONS_DIR)) return null;
  return fs.existsSync(p) ? p : null;
}

/**
 * 执行 pdf2zh 翻译一篇 PDF，产出双语/译文两份 PDF 并落产物（type=translation, kind=pdf）。
 * 返回 artifactId 供前端预览/下载。
 */
export function runPdf2zh(sourceId: number): Promise<{ artifactId: number; doc: PdfTranslationDoc }> {
  return new Promise((resolve, reject) => {
    const src = db
      .prepare("SELECT id, title, filename FROM sources WHERE id = ?")
      .get(sourceId) as { id: number; title: string; filename: string | null } | undefined;
    if (!src) return reject(new Error(`资源 #${sourceId} 不存在`));
    const storage = src.filename ?? "";
    if (!storage.toLowerCase().endsWith(".pdf")) return reject(new Error("该资源不是 PDF 文件"));
    const bin = pdf2zhBin();
    if (!fs.existsSync(bin)) {
      return reject(new Error(`未找到 pdf2zh（${bin}）。安装：uv tool install --python 3.12 pdf2zh`));
    }
    const original = path.join(process.cwd(), "data", "uploads", path.basename(storage));
    if (!fs.existsSync(original)) return reject(new Error("原始 PDF 文件不存在（可能已被删除）"));

    const outDir = path.join(TRANSLATIONS_DIR, String(sourceId));
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const up = translateUpstream();
    if (!up.baseUrl || !up.apiKey || !up.model) {
      return reject(new Error("未配置翻译模型（设置 → 翻译模型，或对话模型兜底）"));
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENAILIKED_BASE_URL: up.baseUrl,
      OPENAILIKED_API_KEY: up.apiKey,
      OPENAILIKED_MODEL: up.model,
      HF_ENDPOINT: "https://hf-mirror.com", // 版面 ONNX 模型走镜像，绕开 hf.co 直连超时
    };

    execFile(
      bin,
      [original, "-s", "openailiked", "-lo", "zh", "-o", outDir],
      { env, timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        const base = path.basename(original, ".pdf");
        const dualPath = path.join(outDir, `${base}-dual.pdf`);
        const monoPath = path.join(outDir, `${base}-mono.pdf`);
        if (!fs.existsSync(dualPath)) {
          const msg = (err as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT"
            ? `翻译超时（>${RUN_TIMEOUT_MS / 1000}s，文档过长可拆分后重试）`
            : err
              ? String((err as Error).message).slice(0, 240)
              : "未产出双语 PDF";
          const tail = stderr && typeof stderr === "string" ? `｜${stderr.slice(-240)}` : "";
          return reject(new Error(`${msg}${tail}`));
        }
        const doc: PdfTranslationDoc = {
          kind: "pdf",
          sourceId,
          sourceTitle: src.title,
          dualPdf: path.relative(TRANSLATIONS_DIR, dualPath),
          monoPdf: fs.existsSync(monoPath) ? path.relative(TRANSLATIONS_DIR, monoPath) : undefined,
          model: up.model,
          engine: "pdf2zh",
          translatedAt: Date.now(),
        };
        const info = db
          .prepare(
            "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'translation', ?, ?, ?, ?, ?)"
          )
          .run(
            getAigcCategoryId(),
            `《${src.title.slice(0, 30)}》双语翻译`,
            JSON.stringify(doc),
            JSON.stringify([sourceId]),
            up.model,
            Date.now()
          );
        resolve({ artifactId: Number(info.lastInsertRowid), doc });
      }
    );
  });
}
