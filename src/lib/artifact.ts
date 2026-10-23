import db, { getSettings, isModelConfigured, recordUsage } from "./db";
import { estimateTokens } from "./embed";
import { modelEndpoint, modelHeaders } from "./modelGateway";

const SYSTEM = `你是学习资料整理助手。根据提供的资料片段生成结构化中文复习笔记，输出 markdown：
# 标题、## 一、概述、## 二、核心要点（分条）、## 三、术语表（表格）、## 四、可能的考点。
只使用资料里出现的内容，不要编造。`;

/** 从选中资源取块拼上下文（供复习笔记 / 便签引擎共用） */
export function gatherContext(sourceIds: number[]): {
  context: string;
  perSource: Map<string, string[]>;
} {
  if (!sourceIds.length) throw new Error("请先选择至少一份可检索的资源");
  const ph = sourceIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT s.title, c.page, c.text FROM chunks c JOIN sources s ON s.id = c.source_id
       WHERE c.source_id IN (${ph}) ORDER BY s.id, c.idx`
    )
    .all(...sourceIds) as Array<{ title: string; page: number | null; text: string }>;

  // 每份资源最多取前 8 块，控制上下文长度
  const perSource = new Map<string, string[]>();
  for (const r of rows) {
    const arr = perSource.get(r.title) ?? [];
    if (arr.length < 8) arr.push(r.page != null ? `[p${r.page}] ${r.text}` : r.text);
    perSource.set(r.title, arr);
  }
  const context = [...perSource.entries()]
    .map(([title, chunks]) => `《${title}》\n${chunks.join("\n")}`)
    .join("\n\n");
  return { context, perSource };
}

/** 生成摘要笔记：从类目选中的资源取块 → 模型（或 mock）产出 markdown → 存 artifacts */
export async function generateSummary(sourceIds: number[]): Promise<{
  title: string; content: string; model: string;
}> {
  const { context, perSource } = gatherContext(sourceIds);
  const s = getSettings();
  const fallbackTitle = `${[...perSource.keys()][0] ?? "资料"}·摘要笔记`;

  if (!isModelConfigured(s)) {
    const content = mockSummary(fallbackTitle, perSource);
    recordUsage("chat", "mock-artifact", estimateTokens(context), estimateTokens(content));
    return { title: fallbackTitle, content, model: "mock" };
  }

  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `资料片段：\n${context}\n\n请生成复习笔记。` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`模型接口错误 HTTP ${res.status}`);
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("模型返回了空内容");
  recordUsage(
    "chat", s.chatModel,
    data.usage?.prompt_tokens ?? estimateTokens(context),
    data.usage?.completion_tokens ?? estimateTokens(content)
  );
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallbackTitle;
  return { title, content, model: s.chatModel };
}

function mockSummary(title: string, perSource: Map<string, string[]>): string {
  const lines = [`# ${title}（演示）`, "", "> 未配置模型，这是由资料片段拼装的演示笔记。配置后此处为真实生成内容。", "", "## 一、概述", ""];
  lines.push(`本笔记基于 ${perSource.size} 份资源生成。`, "", "## 二、核心要点", "");
  for (const [src, chunks] of perSource) {
    lines.push(`### 《${src}》`);
    for (const c of chunks.slice(0, 3)) lines.push(`- ${c.replace(/\[p\d+\]\s*/, "").slice(0, 80)}…`);
    lines.push("");
  }
  return lines.join("\n");
}


