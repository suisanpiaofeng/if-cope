/**
 * 课堂笔记回流 RAG（规格 §6）：
 * 笔记/手册 content_md → sources（type=笔记）→ 现有 chunk/embed/FTS 链路；
 * 重生成幂等：旧 source 级联删除（chunks/FTS 由 db.ts 触发器同步），不叠加。
 */
import db from "@/lib/db";
import { saveFile, sha256 } from "@/lib/storage";
import { ingestSource } from "@/lib/ingest";

/** 登记笔记进资料库（oldSourceId 存在则先删旧的——重生成替换语义，Review Focus #5） */
export async function registerNoteAsSource(input: {
  title: string;
  contentMd: string;
  oldSourceId?: number | null;
}): Promise<{ ok: boolean; sourceId?: number; error?: string }> {
  // 删旧（chunks/FTS 由触发器级联）
  if (input.oldSourceId) {
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(input.oldSourceId);
    db.prepare("DELETE FROM sources WHERE id = ?").run(input.oldSourceId);
  }

  const buffer = Buffer.from(input.contentMd, "utf8");
  const storageName = saveFile(buffer, "md");
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO sources (title, filename, ext, mime, size, sha256, source_type, url, type, category_id, status, created_at)
       VALUES (?, ?, 'md', 'text/markdown', ?, ?, 'file', NULL, '笔记', NULL, 'processing', ?)`
    )
    .run(input.title, storageName, buffer.length, sha256(buffer), now);
  const sourceId = Number(info.lastInsertRowid);

  // 切块 + 向量化 + FTS（ingestSource 内部失败会把 status 置 failed，不 throw）
  await ingestSource(sourceId);

  const row = db.prepare("SELECT status FROM sources WHERE id = ?").get(sourceId) as
    | { status: string }
    | undefined;
  if (row?.status === "failed") {
    // 笔记本体已生成，回流失败不连坐笔记（错误透传给 UI 提示）
    return { ok: true, sourceId, error: "笔记已生成，但未入检索索引（向量化失败？）" };
  }
  return { ok: true, sourceId };
}
