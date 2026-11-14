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
import db from "./db";
import { sourcePath } from "./fileTree";
import { translateUpstream } from "./translate";
import { saveFile, sha256 } from "./storage";
import { ingestSource } from "./ingest";
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
 * 执行 pdf2zh 翻译一篇 PDF，产出译文 PDF 并**入库为资源**（唯一一份：可预览/可检索/进资源目录）。
 * 不再另造 AIGC 产物（避免同一份 PDF 出现两份）；历史记录由翻译页从 type=翻译 的资源推导。
 */
export function runPdf2zh(sourceId: number): Promise<{ translatedSourceId: number; doc: PdfTranslationDoc }> {
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
    const original = sourcePath({ filename: storage });
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
        const monoPath = path.join(outDir, `${base}-mono.pdf`);
        if (!fs.existsSync(monoPath)) {
          const msg = (err as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT"
            ? `翻译超时（>${RUN_TIMEOUT_MS / 1000}s，文档过长可拆分后重试）`
            : err
              ? String((err as Error).message).slice(0, 240)
              : "未产出译文 PDF";
          const tail = stderr && typeof stderr === "string" ? `｜${stderr.slice(-240)}` : "";
          return reject(new Error(`${msg}${tail}`));
        }
        void (async () => {
          try {
            // 译文 PDF 入库为资源：单份存储（移入 uploads），进原资源同类目，自动解析可检索
            const buffer = fs.readFileSync(monoPath);
            const hash = sha256(buffer);
            let translatedSourceId: number;
            const dup = db.prepare("SELECT id FROM sources WHERE sha256 = ?").get(hash) as { id: number } | undefined;
            if (dup) {
              translatedSourceId = dup.id; // 同译文已入库（重译同一文件）：复用，不重复占存储
            } else {
              const storageName = saveFile(buffer, "pdf");
              const cat = (
                db.prepare("SELECT category_id FROM sources WHERE id = ?").get(sourceId) as
                  | { category_id: number | null }
                  | undefined
              )?.category_id;
              const info = db
                .prepare(
                  `INSERT INTO sources (title, filename, ext, mime, size, sha256, source_type, url, type, category_id, status, created_at, origin_id)
                   VALUES (?, ?, 'pdf', 'application/pdf', ?, ?, 'file', NULL, '翻译', ?, 'processing', ?, ?)`
                )
                .run(`《${src.title.slice(0, 40)}》译文`, storageName, buffer.length, hash, cat, Date.now(), sourceId);
              translatedSourceId = Number(info.lastInsertRowid);
              await ingestSource(translatedSourceId); // 同步解析+嵌入（译文可被对话检索）
            }
            const doc: PdfTranslationDoc = {
              kind: "pdf",
              sourceId,
              sourceTitle: src.title,
              translatedSourceId,
              model: up.model,
              engine: "pdf2zh",
              translatedAt: Date.now(),
            };
            fs.rmSync(outDir, { recursive: true, force: true }); // 临时目录清掉（含双语版，不留死重）
            resolve({ translatedSourceId, doc });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      }
    );
  });
}
