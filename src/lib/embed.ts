import db, { getSettings, setSettings, recordUsage, type ModelSettings } from "./db";
import { modelHeaders, modelEndpoint } from "./modelGateway";
import { localEmbed, LOCAL_EMBED_MODEL, LOCAL_EMBED_DIM } from "./localEmbed";

/** 嵌入统一出口，三级优先：
 *  1. 远程嵌入模型（配置了 embedModel）
 *  2. 本地模型 bge-small-zh-v1.5（免配置默认，384 维）
 *  失败时明确报错，不悄悄退回 mock，避免污染索引。 */
export async function embedTexts(
  texts: string[],
  settingsOverride?: ModelSettings
): Promise<number[][]> {
  const s = settingsOverride ?? getSettings();
  if (!s.baseUrl || !s.apiKey || !s.embedModel) {
    // 本地模型路径：与旧 mock（256 维）互斥，维度不符时提示重建
    if (s.embeddingDimension && s.embeddingDimension !== LOCAL_EMBED_DIM) {
      throw new Error(
        `当前索引维度为 ${s.embeddingDimension}，本地嵌入模型为 ${LOCAL_EMBED_DIM} 维；请到设置页重新保存以重建索引。`
      );
    }
    let vectors: number[][];
    try {
      vectors = await localEmbed(texts);
    } catch (err) {
      throw new Error(
        `本地嵌入模型不可用（${err instanceof Error ? err.message : String(err)}）；` +
        `首次使用需联网下载模型（约 100MB，已配置 hf-mirror 镜像），请稍后重试。`
      );
    }
    recordUsage("embed", LOCAL_EMBED_MODEL, estimateTokens(texts.join(" ")), 0);
    // 首次生效时把维度写回设置，保护后续一致性
    if (!s.embeddingDimension) setSettings({ ...s, embeddingDimension: LOCAL_EMBED_DIM });
    return vectors;
  }

  const res = await fetch(modelEndpoint(s.baseUrl, "embeddings"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({ model: s.embedModel, input: texts }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`嵌入接口错误 HTTP ${res.status}：${msg.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number };
    data: Array<{ embedding: number[]; index: number }>;
  };
  recordUsage(
    "embed",
    s.embedModel,
    data.usage?.prompt_tokens ?? estimateTokens(texts.join(" ")),
    0
  );
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => normalize(d.embedding));
  if (s.embeddingDimension && vectors.some((v) => v.length !== s.embeddingDimension)) {
    throw new Error(
      `嵌入维度不一致：索引配置为 ${s.embeddingDimension}，接口返回 ${vectors[0]?.length ?? 0}`
    );
  }
  return vectors;
}

/** 更换嵌入模型后，将所有已有 chunk 用新配置原地重建。 */
export async function rebuildEmbeddingIndex(settingsOverride?: ModelSettings): Promise<number> {
  const s = settingsOverride ?? getSettings();
  const rows = db.prepare("SELECT id, text FROM chunks ORDER BY id").all() as Array<{
    id: number;
    text: string;
  }>;
  if (!rows.length) return 0;

  const update = db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?");
  const batchSize = 32;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map((r) => r.text), s);
    const tx = db.transaction(() => {
      batch.forEach((row, offset) => update.run(JSON.stringify(vectors[offset]), row.id));
    });
    tx();
  }
  return rows.length;
}

export function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.6);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
