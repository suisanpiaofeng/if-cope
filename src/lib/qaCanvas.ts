/**
 * 解题答疑画布：模型生成层（服务端专用，依赖 db/模型网关）。
 * 类型与纯函数（normalize / markdown 导出）在 qaCanvasTypes.ts（客户端安全），
 * 渲染组件与页面只允许依赖 qaCanvasTypes，禁止 import 本文件（会把原生模块拖进浏览器包）。
 */
import { getSettings, isModelConfigured, recordUsage } from "./db";
import { estimateTokens } from "./embed";
import { modelEndpoint, modelHeaders } from "./modelGateway";
import { gatherContext } from "./artifact";
import { normalizeQaCanvas, type QaCanvasData } from "./qaCanvasTypes";

export type { QaCite, QaNode, QaNodeKind, QaCanvasData } from "./qaCanvasTypes";
export { normalizeQaCanvas, qaCanvasToMarkdown } from "./qaCanvasTypes";

const SYSTEM = `你是解题答疑助手。针对学生的提问输出一张结构化的解答图，严格输出一个 JSON 对象，不要输出其他文字：
{"title":"解答标题","nodes":[{"id":"n1","parent":null,"kind":"question","label":"问题","detail":"问题的准确表述","cites":[{"sourceId":23,"page":2,"quote":"原文片段"}]}]}
契约：
- id 唯一字符串；parent 指向父节点 id（根节点 parent 为 null）
- kind 取值：question（根问题，有且仅有一个）/ approach（解题思路）/ step（推导步骤）/ knowledge（涉及的知识点）/ pitfall（易错点）/ answer（最终结论）
- label 是短标签（12 字内）；detail 是该节点的详细内容（可含公式、代码）
- cites 仅在内容确有资料依据时给：sourceId 必须来自提供的资料编号，page 为页码（不知道写 null），quote 为原文短摘录（30 字内）；资料没覆盖的内容不要编造引用
- 结构要求：question 下挂 approach/answer 主线，旁支挂 knowledge/pitfall；节点总数 6-14 个
- 提问若包含图片，先正确读图再解题`;

/** 生成解答图：问题（+可选图片）+ 选中资料 → 结构化 JSON */
export async function generateQaCanvas(
  question: string,
  sourceIds: number[],
  imageDataUrl?: string | null
): Promise<{ canvas: QaCanvasData; model: string }> {
  const { context } = sourceIds.length
    ? gatherContext(sourceIds)
    : { context: "" };
  const s = getSettings();

  if (!isModelConfigured(s)) {
    recordUsage("solve", "mock-qa", estimateTokens(question), 200);
    return { canvas: mockCanvas(question), model: "mock" };
  }

  // 图片走 OpenAI 兼容的多模态消息格式（不支持视觉的模型会报错，由调用方提示换视觉模型）
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: `学生提问：${question}${context ? `\n\n可用资料片段：\n${context}` : "\n\n（未提供资料，按通用知识解答）"}` }];
  if (imageDataUrl) {
    userContent.push({ type: "image_url", image_url: { url: imageDataUrl } });
  }

  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (imageDataUrl && (res.status === 400 || res.status === 422)) {
      throw new Error("当前模型不支持图片理解：请在设置里换视觉模型（如 qwen-vl / gpt-4o），或去掉图片用文字描述题目");
    }
    throw new Error(`模型接口错误 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  recordUsage(
    "solve", s.chatModel,
    data.usage?.prompt_tokens ?? estimateTokens(question + context),
    data.usage?.completion_tokens ?? estimateTokens(text)
  );
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("模型输出无法解析为解答图，请重试或换个问法");
  }
  const canvas = normalizeQaCanvas(parsed);
  if (!canvas) throw new Error("模型输出的解答图结构不完整，请重试");
  return { canvas, model: s.chatModel };
}

function mockCanvas(question: string): QaCanvasData {
  const q = question.slice(0, 40) || "这道题";
  return {
    title: `${q}·解答（演示）`,
    nodes: [
      { id: "root", parent: null, kind: "question", label: "问题", detail: `${question}（未配置模型，这是演示解答图）` },
      { id: "a1", parent: "root", kind: "approach", label: "解题思路", detail: "先分析题目考查的知识点，再逐步推导。" },
      { id: "s1", parent: "a1", kind: "step", label: "步骤一", detail: "提取题干中的已知条件。" },
      { id: "s2", parent: "a1", kind: "step", label: "步骤二", detail: "选择对应公式/定理代入求解。" },
      { id: "k1", parent: "root", kind: "knowledge", label: "知识点", detail: "配置模型后，这里会标注资料出处（第几页原文）。" },
      { id: "ans", parent: "root", kind: "answer", label: "结论", detail: "最终答案与验证。" },
    ],
  };
}
