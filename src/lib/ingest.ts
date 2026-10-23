import db from "./db";
import { parseFile, parseUrl, extOf } from "./parse";
import { chunkPages, Chunk, CHUNK_LIMIT } from "./chunk";
import { embedTexts } from "./embed";

/** 解析 → 结构感知切块 → 标题上下文注入嵌入 → 入库。同步执行，demo 规模文件秒级完成。
 *  索引 2.0：heading 路径随块存储；FTS5 由 db.ts 触发器自动同步，此处无需关心。 */
export async function ingestSource(sourceId: number) {
  const src = db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId) as
    | { id: number; title: string; source_type: string; url: string | null; filename: string }
    | undefined;
  if (!src) return;

  try {
    let pages;
    if (src.source_type === "link") {
      const { text, title } = await parseUrl(src.url!);
      pages = [{ page: null, text }];
      // 爬取成功后用页面真实标题替换 URL 标题
      if (title) db.prepare("UPDATE sources SET title = ? WHERE id = ?").run(title.slice(0, 200), sourceId);
    } else {
      const { readFile } = await import("./storage");
      const row = db
        .prepare("SELECT filename, mime FROM sources WHERE id = ?")
        .get(sourceId) as { filename: string; mime: string };
      const buffer = readFile(row.filename);
      // 用存储名（uuid.ext）判断类型：上传文件名可能被客户端转码
      const parsed = await parseFile(buffer, row.filename, row.mime);
      pages = parsed.pages;
      if (parsed.note) {
        db.prepare("UPDATE sources SET note = ? WHERE id = ?").run(parsed.note, sourceId);
      }
    }

    db.prepare("UPDATE sources SET page_count = ? WHERE id = ?").run(
      pages.filter((p) => p.page != null).length || (pages.length ? 1 : 0),
      sourceId
    );

    // 幂等：任何入口（上传/重新解析/编辑保存）都先清旧块（FTS 触发器同步删）
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(sourceId);

    // 结构感知分块：md/markdown 用 # 标题栈，其他（pdf/docx/txt/网页）用中文章节序号
    const ext = extOf(src.filename);
    const isMd = ext === "md" || ext === "markdown";
    const { chunks, truncated } = chunkPages(pages, { markdown: isMd });

    if (chunks.length) {
      // 标题上下文注入（Contextual Retrieval 思想）：块嵌入前拼 `[文档 > 章节]` 前缀，
      // 查询侧保持原样 —— 让块自带定位信息，专有名词/章节类召回显著提升。
      const docTitle = src.title.slice(0, 60);
      const inputs = chunks.map((c) =>
        c.heading ? `[${docTitle} > ${c.heading}] ${c.text}` : `[${docTitle}] ${c.text}`
      );
      const vectors = await embedTexts(inputs);
      const insert = db.prepare(
        "INSERT INTO chunks (source_id, page, idx, heading, text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const tx = db.transaction(() => {
        chunks.forEach((c, i) =>
          insert.run(sourceId, c.page, i, c.heading, c.text, JSON.stringify(vectors[i]), Date.now())
        );
      });
      tx();
    }

    const note = (db.prepare("SELECT note FROM sources WHERE id = ?").get(sourceId) as { note: string | null } | undefined)?.note;
    if (truncated) {
      const cut = `内容过长，已截取前 ${CHUNK_LIMIT} 个分块参与检索`;
      db.prepare("UPDATE sources SET note = ? WHERE id = ?").run(note ? `${note}；${cut}` : cut, sourceId);
    }

    db.prepare("UPDATE sources SET status = 'ready', chunk_count = ? WHERE id = ?").run(
      chunks.length,
      sourceId
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE sources SET status = 'failed', note = ? WHERE id = ?").run(
      msg.slice(0, 500),
      sourceId
    );
  }
}
