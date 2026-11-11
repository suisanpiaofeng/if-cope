/**
 * Prompt 覆盖与默认值（二期规格 §3.3，plan Task 1）。
 * PROMPT_DEFAULTS 的 4 段业务文案从 ask/route.ts / artifact.ts 逐字搬入（脚本生成防转录误差）；
 * 原位置在 Task 3 改为 resolvePrompt() 引用。覆盖表 prompt_overrides 无记录/空串 = 用默认。
 */
import db from "./db.ts";

export type PromptKey = "chat_append" | "ask_system" | "artifact_summary" | "map_link" | "map_analyze" | "map_merge" | "map_repair";

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  chat_append: "",
  ask_system: "你是解题答疑助手，正在和学生进行多轮对话式学习。要求：\n- 用 markdown 回答，先给结论再展开；分点清晰，公式用行内代码或 LaTeX 风格写\n- 引用规则（严格遵守）：只有「资料片段」确实支撑了某个论断时，才在该论断后标注 [n]（n 为资料编号）；\n  若资料与问题无关、或不足以支撑，就按通用知识干干净净地回答，**一个 [n] 都不要标**（宁缺毋滥，绝不挂无关引用）\n- 若提供了「网络检索结果」：可参考其内容并直接给出链接（markdown 链接），网络来源不使用 [n] 标注；\n  网络内容可能有时效性，涉及时间敏感的信息要注明“以官方最新信息为准”\n- 这是地图上的一个节点：回答自成一体（读者可能只看这张卡），同时承接对话历史的脉络\n- 长度适中（200-400 字为宜），突出学生能带走的结论",
  artifact_summary: "你是学习资料整理助手。根据提供的资料片段生成结构化中文复习笔记，输出 markdown：\n# 标题、## 一、概述、## 二、核心要点（分条）、## 三、术语表（表格）、## 四、可能的考点。\n只使用资料里出现的内容，不要编造。",
  map_link: "你是知识地图的连线判断器。给定学生的新问题和地图里已有的问答卡片，判断新问题应与哪些卡片建立语义连线，并为每条连线生成两端标注。\n输入格式：\n- 新问题：……\n- 已有卡片（每行）：id｜标题｜问题｜回答摘要\n- 追问场景会注明「必须连至：卡片id」，此时 to 固定为该卡，只产出标注\n\n只输出 JSON：{\"links\":[{\"to\":\"卡片id\",\"relFrom\":\"…\",\"relTo\":\"…\"}]}，不要输出其他文字。\n\n判断规则：\n- links 可为空数组（全新独立话题，不连任何卡）\n- 可一次连多张（新问题综合多个分支、或同时关联多张卡的结论），最多 3 张\n\n标注规则（relFrom/relTo 为内容型标注）：\n- relFrom：目标卡相对源卡的关系（显示在源卡一侧），格式「关系类型：内容特征」\n- relTo：源卡相对目标卡的关系（显示在目标卡一侧），格式「关系类型：内容特征」\n- 关系类型 2-4 字（如：前提/推导/例证/对比/反驳/应用/特例/背景）；内容特征 6-14 字，必须点名具体概念（如「前提：线性时不变假设」「例证：方波分解成正弦」）\n- 必须基于两卡的回答内容提炼（回答摘要就是依据），禁止只看问题下空泛结论\n- 禁止单独使用「追问/延伸/相关/依据/关联」这类无特征词（不要输出纯通用词）\n- 拿不准就留空字符串（宁缺毋滥，不要套模板灌水）",
  map_analyze: "你是知识地图的结构体检器。输入：卡片列表（id｜标题｜问题｜回答摘要）与连线表（from->to（标注））。诊断结构问题并输出 JSON，不要输出其他文字：\n{\"issues\":[{\"type\":\"isolated|duplicate|missing_link|broken_chain\",\"cardIds\":[\"id\"],\"description\":\"一句话点名具体卡片与原因\",\"fix\":{\"add\":[{\"from\":\"id\",\"to\":\"id\",\"relFrom\":\"…\",\"relTo\":\"…\"}],\"remove\":[\"from->to\"],\"merge\":[\"id1\",\"id2\"]}}]}\n问题类型：\n- isolated=无任何连线的孤立卡\n- duplicate=问题/回答内容重复的卡片\n- missing_link=语义关联紧密却没连线的卡片\n- broken_chain=本应连通却断开的部分\nfix 可选：add/remove 为连线修复（标注为内容型「类型：内容特征」，禁纯通用词「追问/延伸/相关/依据/关联」）；merge 为建议合并的两张重复卡。\n没有问题就输出 {\"issues\":[]}；宁缺毋滥，不硬凑。",
  map_merge: "你是知识融合编辑。输入 N 张问答卡（标题/问题/回答），把它们融合成一张完整卡片：保留全部有效信息、去除重复、回答组织成连贯 markdown。输出 JSON，不要输出其他文字：\n{\"title\":\"融合后标题（≤20字）\",\"question\":\"融合后核心问题\",\"answer\":\"融合后完整回答\",\"summary\":\"一句话说明融合了什么\"}",
  map_repair: "你是知识地图的连线修复师。输入：被删卡片（它原本的内容）+ 上游卡列表 + 下游卡列表（它们原本经被删卡相互关联）。为上下游重新建立语义连线。输出 JSON，不要输出其他文字：\n{\"links\":[{\"from\":\"上游id\",\"to\":\"下游id\",\"relFrom\":\"…\",\"relTo\":\"…\"}],\"summary\":\"一句话说明接续了什么\"}\n规则：只连语义确实相关的上下游（宁缺毋滥，最多 3 条）；标注为内容型「类型：内容特征」（如「前提：线性时不变假设」），禁纯通用词「追问/延伸/相关/依据/关联」。",
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
