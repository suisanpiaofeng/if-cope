import path from "path";

/** 本地嵌入模型（免配置默认方案）：
 *  fastembed（Qdrant 出品，ONNX Runtime CPU 推理）
 *  模型：BAAI/bge-small-zh-v1.5 —— 中文检索榜常客，约 100MB，384 维
 *  首次调用自动下载到 data/models/，之后离线可用。 */

// 必须在 import fastembed 之前设置：其内部在模块加载时读取 HF_ENDPOINT
if (!process.env.HF_ENDPOINT) process.env.HF_ENDPOINT = "https://hf-mirror.com";

export const LOCAL_EMBED_MODEL = "bge-small-zh-v1.5";
export const LOCAL_EMBED_DIM = 384;

type FlagEmbedding = import("fastembed").FlagEmbedding;

let modelPromise: Promise<FlagEmbedding> | null = null;

async function getModel(): Promise<FlagEmbedding> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
      return FlagEmbedding.init({
        model: EmbeddingModel.BGESmallZH,
        cacheDir: path.join(process.cwd(), "data", "models"),
        showDownloadProgress: true,
      });
    })();
    // 失败后允许重试（比如首次下载断网）
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

/** 批量文本 → 向量（已归一化） */
export async function localEmbed(texts: string[]): Promise<number[][]> {
  const model = await getModel();
  const out: number[][] = [];
  const gen = model.embed(texts, 8);
  for await (const batch of gen) out.push(...batch);
  return out;
}
