/**
 * 便签引擎：prompt 模板 + 生成（产物统一存 artifacts 表，type = NoteKind）
 * 架构：每种便签 = 一个输出格式契约（渲染器依赖该格式）+ 一个 prompt 模板 + 一个 mock。
 * 模型调用仍走 modelGateway 单出口；未配置模型时降级 mock，UI 链路可完整演示。
 */
import db, { getSettings, isModelConfigured, recordUsage } from "./db";
import { estimateTokens } from "./embed";
import { modelEndpoint, modelHeaders } from "./modelGateway";
import { gatherContext } from "./artifact";
import type { NoteKind } from "./noteKinds";

/** 各便签的输出格式契约（渲染器按此解析，改动需同步渲染组件） */
const PROMPTS: Record<NoteKind, string> = {
  report: `你是学习资料整理助手。根据提供的资料片段生成结构化中文复习笔记，输出 markdown：
# 标题、## 一、概述、## 二、核心要点（分条）、## 三、术语表（表格）、## 四、可能的考点。
只使用资料里出现的内容，不要编造。`,

  mindmap: `你是思维导图整理助手。根据资料片段生成思维导图的 markdown 大纲，严格遵守：
- 第一行是 # 一级主题（只能有一个）
- 用 ## 二级分支、### 三级分支、#### 四级分支表达层级
- 每个节点一行，用 - 列表补充该节点下的要点
- 不要输出除层级大纲以外的任何解释文字
只使用资料里出现的内容，不要编造。`,

  flowchart: `你是流程图整理助手。根据资料片段生成一个 Mermaid 流程图，严格遵守：
- 输出恰好一个 \`\`\`mermaid 代码块，图类型用 flowchart TD
- 节点文字用中文、简短（10 字内），过程/判断逻辑正确
- 代码块前可以用一行 # 标题，代码块后可以用不超过 3 行的要点说明，其余不要输出
只使用资料里出现的内容，不要编造。`,

  outline: `你是大纲整理助手。根据资料片段生成层级分明的复习大纲，严格遵守：
- # 一级标题（一个）、## 二级、### 三级
- 层级下用 - 列表写要点，条目精炼
- 不要输出大纲以外的解释文字
只使用资料里出现的内容，不要编造。`,


  quiz: `你是测验出题助手。根据资料片段生成自测题，严格遵守以下格式：
# 标题
## 第 N 题
题干（可含简短情境）
- A. 选项一
- B. 选项二
- C. 选项三
- D. 选项四
**答案：** A
**解析：** 一句话解析
- 题目数量 5-8 题，单选为主，可含 1-2 道判断题（选项为 A.对 B.错）
- 只使用资料里出现的内容，不要编造`,
};

const TITLE_SUFFIX: Record<NoteKind, string> = {
  report: "复习笔记",
  mindmap: "思维导图",
  flowchart: "流程图",
  outline: "复习大纲",
  quiz: "自测题",
};

export type GeneratedNote = { title: string; content: string; model: string; kind: NoteKind };

/** 把选中的产物内容拼进上下文（每条最多 3000 字符） */
function gatherArtifactContext(artifactIds: number[]): string {
  if (!artifactIds.length) return "";
  const ph = artifactIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT title, content FROM artifacts WHERE id IN (${ph})`)
    .all(...artifactIds) as Array<{ title: string; content: string }>;
  return rows.map((r) => `【产物】${r.title}\n${r.content.slice(0, 3000)}`).join("\n\n");
}

/** 生成便签：选中资源/产物 → 拼上下文 → 按 kind 的格式契约生成 markdown */
export async function generateNote(
  sourceIds: number[],
  kind: NoteKind,
  artifactIds: number[] = []
): Promise<GeneratedNote> {
  const src = sourceIds.length
    ? gatherContext(sourceIds)
    : { context: "", perSource: new Map<string, string[]>() };
  const context = [src.context, gatherArtifactContext(artifactIds)].filter(Boolean).join("\n\n");
  const perSource = src.perSource;
  const s = getSettings();
  const mainTitle = [...perSource.keys()][0] ?? "资料";
  const fallbackTitle = `${mainTitle}·${TITLE_SUFFIX[kind]}`;

  if (!isModelConfigured(s)) {
    const content = mockNote(kind, fallbackTitle, perSource);
    recordUsage("note", "mock-" + kind, estimateTokens(context), estimateTokens(content));
    return { title: fallbackTitle, content, model: "mock", kind };
  }

  const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
    method: "POST",
    headers: modelHeaders(s.apiKey),
    body: JSON.stringify({
      model: s.chatModel,
      messages: [
        { role: "system", content: PROMPTS[kind] },
        { role: "user", content: `资料片段：\n${context}\n\n请生成${TITLE_SUFFIX[kind]}。` },
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
    "note", s.chatModel,
    data.usage?.prompt_tokens ?? estimateTokens(context),
    data.usage?.completion_tokens ?? estimateTokens(content)
  );
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallbackTitle;
  return { title, content, model: s.chatModel, kind };
}

/** 未配置模型时的演示内容（格式与契约一致，保证渲染链路可演示） */
function mockNote(kind: NoteKind, title: string, perSource: Map<string, string[]>): string {
  const names = [...perSource.keys()].slice(0, 4);
  const pick = (i: number) => (names[i] ?? names[0] ?? "资料").replace(/\[p\d+\]\s*/, "").slice(0, 24);
  switch (kind) {
    case "mindmap":
      return [`# ${title}（演示）`, "## 核心概念", `- ${pick(0)}`, `- ${pick(1)}`, "### 延伸要点", `- ${pick(2)}`,
        "## 知识框架", "- 结构一", "- 结构二", "### 细节", "- 要点"].join("\n");
    case "flowchart":
      return [`# ${title}（演示）`, "", "```mermaid", "flowchart TD", "  A[开始学习] --> B{理解概念?}", "  B -- 是 --> C[做练习题]",
        "  B -- 否 --> D[回看资料]", "  D --> B", "  C --> E[总结错题]", "```", "", "- 演示流程：理解→练习→复盘"].join("\n");
    case "outline":
      return [`# ${title}（演示）`, "## 一、主题框架", `- ${pick(0)}`, `- ${pick(1)}`, "### 1.1 细分", "- 要点 A", "- 要点 B",
        "## 二、重点难点", `- ${pick(2)}`].join("\n");
    case "quiz":
      return [`# ${title}（演示）`, "## 第 1 题", `《${pick(0)}》主要讲了什么？`, "- A. 概念与框架", "- B. 无关内容", "- C. 以上都不对", "- D. 无法判断",
        "**答案：** A", "**解析：** 演示题目，配置模型后为真实生成。"].join("\n");
    default:
      return [`# ${title}（演示）`, "", "> 未配置模型，这是演示笔记。配置后此处为真实生成内容。", "", "## 一、概述", "",
        `本笔记基于 ${perSource.size} 份资源生成。`, "", "## 二、核心要点", "",
        ...names.map((n) => `- ${n}`)].join("\n");
  }
}
