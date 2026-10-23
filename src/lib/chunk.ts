import type { ParsedPage } from "./parse";

export type Chunk = { page: number | null; heading: string; text: string };

/** ── 索引 2.0 分块器：对标成熟开源实现 ──
 *  · 递归分层分隔符（LangChain RecursiveCharacterTextSplitter）：段落 → 句子 → 硬切
 *  · 优先完整句子（LlamaIndex SentenceSplitter）：不产生"悬挂句子"
 *  · 结构感知（Docling/LlamaIndex metadata-aware）：标题路径写入 heading，嵌入时注入上下文
 *  · 预算按字符卡 512 token 上限（bge-small-zh）：中文 1 字 ≈ 1 token，留余量
 *  · 保底 1 块（修短笔记 0 块）+ 单源上限（防 package-lock 爆炸） */

const BUDGET = 500;        // 单块目标长度（字符）：卡在 512 token 模型上限内
const HARD_MIN = 5;        // 低于此长度的碎片并入后续块
const MAX_CHUNKS = 200;    // 单源块数上限，超出截断（note 提示）
const HARD_PIECE = 480;    // 极端无分隔长行的兜底硬切长度

/** 句子边界（不切断句子；中文。！？；英文 .!? 需后随空白/引号/行尾，避免小数点误切） */
const SENTENCE_RE = /(?<=[。！？；!?])|(?<=[.!?])(?=\s)|(?<=\n)/;

/** 中文章节标题行（md 的 # 系 + 中文数字序号系） */
const MD_HEADING_RE = /^(#{1,6})\s+(.+)$/;
const CN_SECTION_RE = /^([一二三四五六七八九十]+、|\d+[.、)]\s*\S)/;

/**
 * 按页解析 → 结构感知分块。
 * heading = 当前所在标题路径（如 "第三章 复习 > 3.1 要点"），用于嵌入上下文注入；
 * 标题行本身保留在正文中，绝不丢内容。
 */
export function chunkPages(pages: ParsedPage[], opts: { markdown?: boolean } = {}): {
  chunks: Chunk[];
  truncated: boolean;
} {
  const out: Chunk[] = [];
  let truncated = false;

  for (const p of pages) {
    const sections = splitByHeading(p.text, opts.markdown ?? false);
    for (const sec of sections) {
      const pieces = splitRecursive(sec.text);
      for (const text of pieces) {
        if (out.length >= MAX_CHUNKS) { truncated = true; break; }
        out.push({ page: p.page, heading: sec.heading, text });
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  // 保底：有文本却没切出块（超短文档）→ 整页截断为一块
  if (!out.length) {
    const raw = pages.map((p) => p.text).join("\n").trim();
    if (raw) out.push({ page: pages[0]?.page ?? null, heading: "", text: raw.slice(0, BUDGET) });
  }
  return { chunks: out, truncated };
}

/** 结构感知：按标题行把页切成"节"，维护标题栈（heading = 栈路径）。标题行保留在节文本里。 */
function splitByHeading(text: string, markdown: boolean): { heading: string; text: string }[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const stack: { level: number; name: string }[] = [];
  const sections: { heading: string; text: string[] }[] = [];
  let current: { heading: string; text: string[] } = { heading: "", text: [] };

  const flush = () => {
    if (current.text.join("\n").trim()) sections.push(current);
    current = { heading: "", text: [] };
  };

  for (const line of lines) {
    const m = markdown ? line.match(MD_HEADING_RE) : line.match(CN_SECTION_RE);
    if (m) {
      flush();
      if (markdown) {
        const level = m[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, name: m[2].trim() });
      } else {
        // 中文章节行：整行即章节名（如「三、复习方法」），单层
        stack.length = 0;
        stack.push({ level: 1, name: line.trim().slice(0, 40) });
      }
      current = { heading: stack.map((s) => s.name).join(" > "), text: [line] };
    } else {
      current.text.push(line);
    }
  }
  flush();

  // 无任何标题 → 单节（heading 空）
  if (!sections.length) return [{ heading: "", text }];
  return sections.map((s) => ({ heading: s.heading, text: s.text.join("\n") }));
}

/**
 * 递归分层：段落聚合 → 超预算段落按句子切 → 极端长行硬切兜底。
 * 句子永不被切断（对照原实现的固定滑窗 slice(i, i+520)）。
 */
function splitRecursive(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((s) => s.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t.length >= HARD_MIN) chunks.push(t);
    buf = "";
  };

  for (const para of paragraphs) {
    if (para.length <= BUDGET) {
      if (buf.length + para.length + 1 > BUDGET) flush();
      buf += (buf ? "\n\n" : "") + para;
      continue;
    }
    // 超预算段落：按句子聚合成 ≤BUDGET 的块（句子完整）
    flush();
    let sent = "";
    for (const s of para.split(SENTENCE_RE)) {
      if (!s) continue;
      if (sent.length + s.length > BUDGET && sent) { chunks.push(sent.trim()); sent = ""; }
      if (s.length > HARD_PIECE) {
        // 极端无分隔长行（如压缩的 json/minified）：硬切兜底
        if (sent) { chunks.push(sent.trim()); sent = ""; }
        for (let i = 0; i < s.length; i += HARD_PIECE) {
          const piece = s.slice(i, i + HARD_PIECE).trim();
          if (piece) chunks.push(piece);
        }
        continue;
      }
      sent += s;
    }
    if (sent.trim()) chunks.push(sent.trim());
  }
  flush();
  return chunks;
}

/** 估算字符数（供 ingest 前检查；中文 1 字≈1 token，bge-small-zh 上限 512） */
export const CHUNK_BUDGET = BUDGET;
export const CHUNK_LIMIT = MAX_CHUNKS;
