import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { sha256 } from "@/lib/storage";
import { writeTreeFile } from "@/lib/fileTree";
import { extOf } from "@/lib/parse";
import { ingestSource } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_TYPE_MAP: Record<string, string> = {
  课件: "课件", 真题: "真题", 笔记: "笔记", 录音: "录音", 网页: "网页", 其他: "其他",
};

export async function GET() {
  const sources = db.prepare(
    `SELECT s.*, c.name AS category_name FROM sources s
     LEFT JOIN categories c ON c.id = s.category_id
     ORDER BY s.created_at DESC`
  ).all();
  const categories = db.prepare("SELECT * FROM categories ORDER BY id").all();
  return NextResponse.json({ sources, categories });
}

const MIME_EXT: Record<string, string> = {
  "text/plain": "txt", "text/markdown": "md",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** 目标目录归一化（树相对路径；防穿越；缺省 资料/） */
function normalizeDir(rel: unknown): string {
  const segs = String(rel ?? "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((s) => s && s !== "." && !s.includes(".."));
  return segs.join("/") || "资料";
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  // 网页收藏 / 粘贴文本：JSON
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as {
      url?: string; text?: string; title?: string; categoryId?: number; type?: string;
      path?: string; autoIndex?: boolean;
    };
    const categoryId = body.categoryId ?? null;

    // 粘贴文本：作为 txt 资料入库（图三「复制的文字」模式）
    if (typeof body.text === "string" && body.text.trim()) {
      const text = body.text.replace(/\r\n?/g, "\n").trim();
      const buffer = Buffer.from(text, "utf-8");
      const hash = sha256(buffer);
      const dup = db.prepare("SELECT id, title FROM sources WHERE sha256 = ?").get(hash) as
        | { id: number; title: string }
        | undefined;
      if (dup) {
        return NextResponse.json(
          { duplicate: true, id: dup.id, message: `相同内容已收录为《${dup.title}》，不重复入库` },
          { status: 200 }
        );
      }
      const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
      const title = body.title?.trim() || firstLine.slice(0, 40) || "粘贴的文本";
      const treePath = writeTreeFile(buffer, title, "txt", normalizeDir(body.path));
      const autoIndex = body.autoIndex !== false;
      const id = insertSource({
        title, filename: treePath.split("/").pop()!, path: treePath, ext: "txt", mime: "text/plain",
        size: buffer.length, hash, sourceType: "file", url: null,
        categoryId, type: "笔记", status: autoIndex ? "processing" : "skipped",
      });
      if (autoIndex) await ingestSource(id);
      const src = db.prepare("SELECT status, note, page_count, chunk_count FROM sources WHERE id = ?").get(id);
      return NextResponse.json({ id, ...(src as object) });
    }

    const url = body.url?.trim();
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: "请提供有效的 http(s) 链接或文本内容" }, { status: 400 });
    }
    const id = insertSource({
      title: url, filename: "-", ext: "url", mime: "text/html", size: 0,
      hash: `url:${url}`, sourceType: "link", url, categoryId, type: "网页",
    });
    await ingestSource(id);
    return NextResponse.json({ id });
  }

  // 文件上传：multipart
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  const categoryId = form.get("categoryId") ? Number(form.get("categoryId")) : null;
  const typeRaw = String(form.get("type") ?? "其他");
  const type = ALLOWED_TYPE_MAP[typeRaw] ?? "其他";
  const dirRel = normalizeDir(form.get("path"));
  const autoIndex = String(form.get("autoIndex") ?? "true") !== "false";

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = sha256(buffer);

  const dup = db.prepare("SELECT id, title FROM sources WHERE sha256 = ?").get(hash) as
    | { id: number; title: string }
    | undefined;
  if (dup) {
    return NextResponse.json(
      { duplicate: true, id: dup.id, message: `该文件已收录为《${dup.title}》，不重复入库` },
      { status: 200 }
    );
  }

  const ext = extOf(file.name) || MIME_EXT[file.type] || "bin";
  const treePath = writeTreeFile(buffer, file.name.replace(/\.[^.]+$/, "") || "未命名", ext, dirRel);
  const id = insertSource({
    title: file.name.replace(/\.[^.]+$/, ""),
    filename: treePath.split("/").pop()!,
    path: treePath,
    ext, mime: file.type || "application/octet-stream",
    size: buffer.length, hash, sourceType: "file", url: null,
    categoryId, type, status: autoIndex ? "processing" : "skipped",
  });

  // 同步解析（demo 规模秒级）；失败状态落库，前端可见
  if (autoIndex) await ingestSource(id);
  const src = db.prepare("SELECT status, note, page_count, chunk_count FROM sources WHERE id = ?").get(id);
  return NextResponse.json({ id, ...(src as object) });
}

function insertSource(p: {
  title: string; filename: string; path?: string | null; ext: string; mime: string; size: number;
  hash: string; sourceType: string; url: string | null;
  categoryId: number | null; type: string; status?: string;
}): number {
  const info = db.prepare(
    `INSERT INTO sources (title, filename, path, ext, mime, size, sha256, source_type, url, type, category_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.title, p.filename, p.path ?? null, p.ext, p.mime, p.size, p.hash, p.sourceType, p.url, p.type, p.categoryId, p.status ?? "processing", Date.now());
  return Number(info.lastInsertRowid);
}
