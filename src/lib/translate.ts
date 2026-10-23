/**
 * 文献翻译引擎（服务端）：
 * 素材 = 已解析的 chunks（按页/块，天然段落对齐）→ 分批送模型翻译 → 产物 JSON 存 artifacts。
 * 翻译上游独立（settings.translate*，留空逐项回退对话模型），仍经 modelGateway 单出口工具。
 */
import db, { getSettings, isModelConfigured, recordUsage, getAigcCategoryId } from "./db";
import { estimateTokens } from "./embed";
import { modelEndpoint, modelHeaders } from "./modelGateway";

export type TranslateSegment = { page: number | null; heading: string; src: string; trg: string };

export type TranslationDoc = {
  sourceId: number;
  sourceTitle: string;
  model: string;
  segments: TranslateSegment[];
  truncated?: boolean;
  translatedAt: number;
};

const BATCH = 8;          // 每批送模型的段落数（约 4k 字输入，稳妥不超时）
const MAX_SEGMENTS = 160; // 单篇上限（约 8 万字），超出截断并在产物标注

const SYSTEM = `你是专业学术翻译助手。把给定的资料片段逐段翻译成流畅、术语准确的中文：
- 保持编号一一对应，不合并、不拆分、不遗漏
- 专业术语前后一致；保留公式、代码、变量名、引用标记 [n] 原样
- 输出严格为 JSON 数组：[{"i":0,"t":"译文"},{"i":1,"t":"译文"}]
- 只输出 JSON，不要任何解释`;

/** 解析翻译上游：translate* 逐项回退对话模型配置 */
export function translateUpstream() {
  const s = getSettings();
  return {
    baseUrl: s.translateBaseUrl || s.baseUrl,
    apiKey: s.translateApiKey || s.apiKey,
    model: s.translateModel || s.chatModel,
    configured: Boolean((s.translateBaseUrl || s.baseUrl) && (s.translateApiKey || s.apiKey) && (s.translateModel || s.chatModel)),
  };
}

/** 取素材：按页聚合已解析分块 */
export function loadSegments(sourceId: number): { title: string; segments: TranslateSegment[] } {
  const src = db.prepare("SELECT id, title FROM sources WHERE id = ?").get(sourceId) as
    | { id: number; title: string }
    | undefined;
  if (!src) throw new Error(`资源 #${sourceId} 不存在`);
  const chunks = db
    .prepare(
      "SELECT page, heading, text FROM chunks WHERE source_id = ? AND TRIM(text) != '' ORDER BY idx"
    )
    .all(sourceId) as { page: number | null; heading: string; text: string }[];
  const truncated = chunks.length > MAX_SEGMENTS;
  const segments = (truncated ? chunks.slice(0, MAX_SEGMENTS) : chunks).map((c) => ({
    page: c.page,
    heading: c.heading ?? "",
    src: c.text.trim(),
    trg: "",
  }));
  return { title: src.title, segments };
}

/** 一批段落 → 模型翻译；未配置模型时走演示降级 */
async function translateBatch(
  segs: TranslateSegment[],
  offset: number,
  modelLabel: string
): Promise<void> {
  const up = translateUpstream();
  if (!up.configured) {
    for (const s of segs) s.trg = `[演示译文] ${s.src.slice(0, 120)}${s.src.length > 120 ? "…" : ""}`;
    recordUsage("translate", "mock", 0, 0);
    return;
  }
  const payload = segs.map((s, i) => ({ i, t: s.src }));
  const res = await fetch(modelEndpoint(up.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(up.apiKey),
    body: JSON.stringify({
      model: up.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `待翻译片段：\n${JSON.stringify(payload)}` },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`翻译接口错误 HTTP ${res.status}`);
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  recordUsage(
    "translate", up.model,
    data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(payload)),
    data.usage?.completion_tokens ?? estimateTokens(text)
  );
  const json = text.match(/\[[\s\S]*\]/)?.[0] ?? "";
  let parsed: { i?: number; t?: string }[] = [];
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("翻译输出无法解析为 JSON，请重试");
  }
  const byIndex = new Map(parsed.filter((p) => typeof p?.i === "number").map((p) => [p.i!, p.t ?? ""]));
  segs.forEach((s, i) => {
    s.trg = byIndex.get(i) || s.trg || "（该段翻译缺失，请重试）";
  });
}

/**
 * 翻译整篇：分批串行（进度回调逐批上报），完成后落产物（type=translation）。
 */
export async function translateDocument(
  sourceId: number,
  onProgress: (done: number, total: number) => void
): Promise<{ artifactId: number; doc: TranslationDoc }> {
  const { title, segments } = loadSegments(sourceId);
  if (!segments.length) throw new Error("该资源没有可翻译的文本内容（可能未解析成功）");

  const up = translateUpstream();
  let modelLabel = up.configured ? up.model : "mock";
  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH);
    try {
      await translateBatch(batch, i, modelLabel);
    } catch (err) {
      // 某批失败：已译保留，未译段标注错误，整体仍产出（不让整篇报废）
      for (const s of batch) if (!s.trg) s.trg = `⚠ 该段翻译失败：${err instanceof Error ? err.message : String(err)}`;
    }
    onProgress(Math.min(i + BATCH, segments.length), segments.length);
  }

  const doc: TranslationDoc = {
    sourceId,
    sourceTitle: title,
    model: modelLabel,
    segments,
    truncated: segments.length >= MAX_SEGMENTS ? true : undefined,
    translatedAt: Date.now(),
  };
  const info = db
    .prepare(
      "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'translation', ?, ?, ?, ?, ?)"
    )
    .run(
      getAigcCategoryId(),
      `《${title.slice(0, 30)}》翻译`,
      JSON.stringify(doc),
      JSON.stringify([sourceId]),
      modelLabel,
      Date.now()
    );
  return { artifactId: Number(info.lastInsertRowid), doc };
}
