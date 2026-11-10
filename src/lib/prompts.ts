/**
 * Prompt 覆盖与默认值（二期规格 §3.3，plan Task 1）。
 * PROMPT_DEFAULTS 的 4 段业务文案从 ask/route.ts / artifact.ts 逐字搬入（脚本生成防转录误差）；
 * 原位置在 Task 3 改为 resolvePrompt() 引用。覆盖表 prompt_overrides 无记录/空串 = 用默认。
 */
import db from "./db.ts";

export type PromptKey = "chat_append" | "ask_system" | "artifact_summary" | "map_router" | "map_rel";

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  chat_append: "",
  ask_system: "你是解题答疑助手，正在和学生进行多轮对话式学习。要求：\n- 用 markdown 回答，先给结论再展开；分点清晰，公式用行内代码或 LaTeX 风格写\n- 引用规则（严格遵守）：只有「资料片段」确实支撑了某个论断时，才在该论断后标注 [n]（n 为资料编号）；\n  若资料与问题无关、或不足以支撑，就按通用知识干干净净地回答，**一个 [n] 都不要标**（宁缺毋滥，绝不挂无关引用）\n- 若提供了「网络检索结果」：可参考其内容并直接给出链接（markdown 链接），网络来源不使用 [n] 标注；\n  网络内容可能有时效性，涉及时间敏感的信息要注明“以官方最新信息为准”\n- 这是地图上的一个节点：回答自成一体（读者可能只看这张卡），同时承接对话历史的脉络\n- 长度适中（200-400 字为宜），突出学生能带走的结论",
  artifact_summary: "你是学习资料整理助手。根据提供的资料片段生成结构化中文复习笔记，输出 markdown：\n# 标题、## 一、概述、## 二、核心要点（分条）、## 三、术语表（表格）、## 四、可能的考点。\n只使用资料里出现的内容，不要编造。",
  map_router: "你是知识地图的路由判断器。给定学生的新问题和地图里已有的卡片，判断新问题属于哪种：\n- 对某张卡片的追问/直接相关延伸 → 返回那张卡片的 id\n- 全新的独立话题 → 返回 null\n只输出 JSON：{\"parentId\":\"卡片id或null\"}，不要输出其他文字。判断依据是问题内容的语义关联，选最相关的一张；拿不准就 null。",
  map_rel: "你是知识地图的关系标注器。给定相连的两张问答卡片，分别总结两个方向的关系词：\n- parentEnd：子卡相对父卡的关系（如：追问延伸、深入拆解、案例验证、对比辨析、应用实践、纠错反思）\n- childEnd：父卡相对子卡的关系（如：上文依据、背景来源、概念出处、前情结论、方法出处）\n要求：2-6 个字的中文词，基于两问语义给出比“追问”更具体的词；拿不准时才用通用词。\n只输出 JSON：{\"parentEnd\":\"...\",\"childEnd\":\"...\"}",
};

/** 取生效提示词：有覆盖用覆盖，否则 fallback（空串覆盖视同无覆盖） */
export function resolvePrompt(key: PromptKey, fallback: string): string {
  return getPromptOverride(key) ?? fallback;
}

/** 读覆盖值；无覆盖或覆盖为空返回 null */
export function getPromptOverride(key: PromptKey): string | null {
  const row = db.prepare("SELECT content FROM prompt_overrides WHERE key = ?").get(key) as
    | { content: string }
    | undefined;
  const v = row?.content?.trim();
  return v ? (row!.content) : null;
}

/** 写覆盖值；trim 后空串 = 清除覆盖（DELETE 行） */
export function setPromptOverride(key: PromptKey, content: string): void {
  const t = String(content ?? "").trim();
  if (!t) {
    db.prepare("DELETE FROM prompt_overrides WHERE key = ?").run(key);
    return;
  }
  db.prepare("INSERT OR REPLACE INTO prompt_overrides (key, content, updated_at) VALUES (?, ?, ?)").run(
    key,
    t,
    Date.now()
  );
}
