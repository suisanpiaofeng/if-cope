import db from "./db";
import { cosine, embedTexts } from "./embed";

export type Retrieved = {
  n: number;
  chunkId: number;
  sourceId: number;
  title: string;
  page: number | null;
  quote: string;
  score: number;
};

/** ── 索引 2.0 混合检索：FTS5 关键词 + 向量语义，RRF 融合 ──
 *  （Khoj/Quivr/RAGFlow 式 hybrid：关键词路抓专有名词/编号/精确词，
 *   向量路抓语义相似；RRF 只看排名不看分数量纲，无需调权。） */

const RRF_K = 60;          // RRF 常数（Cormack 2009 经典值，各项目通用）
const VECTOR_TOP = 16;     // 向量路召回
const FTS_TOP = 16;        // 关键词路召回
const FINAL_TOP = 6;       // 最终喂给模型的块数

/** 生成 FTS5 trigram 查询：中文无空格分词，把查询切成滑动 3-gram 短语 OR。
 *  trigram 按 3 字建索引，<3 字查询直接放弃（由向量路兜底）。 */
export function ftsQueryFor(question: string): string | null {
  const clean = question.replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, "");
  if (clean.length < 3) return null;
  if (clean.length === 3) return `"${clean}"`;
  const grams: string[] = [];
  const step = clean.length > 24 ? Math.ceil(clean.length / 12) : 2; // 长查询降采样，控 gram 数
  for (let i = 0; i <= clean.length - 3 && grams.length < 16; i += step) {
    grams.push(`"${clean.slice(i, i + 3)}"`);
  }
  return grams.join(" OR ");
}

type Row = {
  id: number;
  source_id: number;
  page: number | null;
  text: string;
  title: string;
};

/** 双路检索 → RRF 融合 → top-N */
export async function retrieve(
  question: string,
  sourceIds: number[],
  topK = FINAL_TOP
): Promise<Retrieved[]> {
  if (!sourceIds.length) return [];
  const ph = sourceIds.map(() => "?").join(",");

  // ── 路 1：向量语义 ──
  const [qvec] = await embedTexts([question]);
  const rows = db
    .prepare(
      `SELECT c.id, c.source_id, c.page, c.text, c.embedding, s.title
       FROM chunks c JOIN sources s ON s.id = c.source_id
       WHERE c.source_id IN (${ph}) AND c.embedding IS NOT NULL`
    )
    .all(...sourceIds) as Array<Row & { embedding: string }>;

  const parsed = rows.map((r) => ({ ...r, vector: JSON.parse(r.embedding) as number[] }));
  const mismatch = parsed.find((r) => r.vector.length !== qvec.length);
  if (mismatch) {
    throw new Error(`检索索引维度为 ${mismatch.vector.length}，当前嵌入模型返回 ${qvec.length}；请到设置页重新保存嵌入配置以重建索引。`);
  }
  const byId = new Map(parsed.map((r) => [r.id, r]));
  const vecRanked = parsed
    .map((r) => ({ id: r.id, score: cosine(qvec, r.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, VECTOR_TOP);

  // ── 路 2：FTS5 关键词（trigram；查询构建失败/无命中则该路不贡献） ──
  let ftsRanked: { id: number }[] = [];
  const q = ftsQueryFor(question);
  if (q) {
    try {
      ftsRanked = (
        db
          .prepare(
            `SELECT rowid AS id FROM chunks_fts
             WHERE chunks_fts MATCH ? AND rowid IN (SELECT id FROM chunks WHERE source_id IN (${ph}))
             ORDER BY rank LIMIT ?`
          )
          .all(q, ...sourceIds, FTS_TOP) as { id: number }[]
      ).map((r) => ({ id: r.id }));
    } catch {
      /* FTS 查询语法异常时静默降级为纯向量 */
    }
  }

  // ── RRF 融合 ──
  const rrf = new Map<number, number>();
  const add = (list: { id: number }[]) =>
    list.forEach((r, i) => rrf.set(r.id, (rrf.get(r.id) ?? 0) + 1 / (RRF_K + i + 1)));
  add(vecRanked);
  add(ftsRanked);

  const fused = [...rrf.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // 补全元数据：FTS 路命中但不在向量结果集里的块（如 embedding 为 NULL 的历史块）
  const missing = fused.filter((f) => !byId.has(f.id)).map((f) => f.id);
  if (missing.length) {
    const extra = db
      .prepare(
        `SELECT c.id, c.source_id, c.page, c.text, s.title FROM chunks c
         JOIN sources s ON s.id = c.source_id WHERE c.id IN (${missing.map(() => "?").join(",")})`
      )
      .all(...missing) as Row[];
    for (const r of extra) byId.set(r.id, { ...r, vector: [], embedding: "" });
  }

  return fused.map((f, i) => {
    const r = byId.get(f.id)!;
    return {
      n: i + 1,
      chunkId: r.id,
      sourceId: r.source_id,
      title: r.title,
      page: r.page,
      quote: r.text.slice(0, 120),
      score: Number(f.score.toFixed(4)),
    };
  });
}

/** 组装喂给模型的上下文块，带序号供引用标注；heading 作为定位信息一并给模型 */
export function buildContextBlocks(hits: Retrieved[]): string[] {
  return hits.map((h) => {
    const full = db
      .prepare("SELECT text, heading FROM chunks WHERE id = ?")
      .get(h.chunkId) as { text: string; heading: string };
    const loc =
      h.page != null ? `《${h.title}》第 ${h.page} 页` : `《${h.title}》`;
    const sec = full.heading ? ` · ${full.heading}` : "";
    return `[${h.n}] 来源：${loc}${sec}\n${full.text}`;
  });
}
