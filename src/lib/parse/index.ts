import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";
import { parsePptx } from "./pptx";
import { transcribeAudio } from "./audio";
import { CODE_EXTS } from "../preview";

export type ParsedPage = { page: number | null; text: string };
export type ParseResult = { pages: ParsedPage[]; note?: string };

const TEXT_EXTS = new Set(["txt", "md", "markdown", ...CODE_EXTS]);

export function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/**
 * 解析分发：能本地提文本的提文本（保留页码，供引用锚点用）；
 * 图片/音频这类必须依赖模型能力的，返回占位说明（配置模型后可扩展 OCR/STT 通道）。
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
  mime: string
): Promise<ParseResult> {
  const ext = extOf(filename);
  if (ext === "pdf" || mime === "application/pdf") return parsePdf(buffer);
  if (ext === "docx" || mime.includes("wordprocessingml")) return parseDocx(buffer);
  if (ext === "pptx" || mime.includes("presentationml")) return parsePptx(buffer);
  if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) {
    return { pages: [{ page: null, text: buffer.toString("utf-8") }] };
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) || mime.startsWith("image/")) {
    return {
      pages: [],
      note: "图片资料需配置视觉模型后解析（OCR 通道），当前已收录原文，暂未参与检索",
    };
  }
  if (["mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "webm", "mp4"].includes(ext) || mime.startsWith("audio/") || mime.startsWith("video/")) {
    // 本地 STT（whisper-tiny ONNX）：格式自动探测，转写文本直接进入分块检索链
    const r = await transcribeAudio(buffer);
    if (!r.text) {
      return {
        pages: [],
        note: `转写完成但未识别出语音内容（${r.durationSec}s，可能为纯音乐/静音）`,
      };
    }
    return {
      pages: [{ page: null, text: r.text }],
      note: `已本地转写（${r.model}，${r.durationSec}s${r.truncated ? "，仅前5分钟" : ""}）`,
    };
  }
  if (ext === "doc" || ext === "xls" || ext === "xlsx" || ext === "ppt") {
    throw new Error(`暂不支持 .${ext}（请另存为 ${ext === "doc" ? ".docx" : ext === "ppt" ? ".pptx" : ".csv"} 后上传）`);
  }
  throw new Error(`不支持的文件类型 .${ext}`);
}

/** 网页抓取：取正文纯文本（demo 级实现，够用即可） */
export async function parseUrl(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; IFCopeDemo/0.1)" },
  });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  const html = await res.text();
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || new URL(url).hostname;
  const text = htmlToText(html);
  if (!text.trim()) throw new Error("未能从该页面提取到正文");
  return { title, text: text.slice(0, 200_000) };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
