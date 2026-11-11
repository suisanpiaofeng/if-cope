/**
 * 知识连线共享模块（规格 2026-11-10-qa-map-graph-redesign §3）：
 * decideLinks 一次调用产出连线 + 两端内容型标注；供 ask 路由与 qa-map/labels API 复用。
 * 依赖 db/modelGateway/prompts（服务端）。
 */
import { getSettings, isModelConfigured } from "@/lib/db";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { resolvePrompt, PROMPT_DEFAULTS } from "@/lib/prompts";
import type { QaMapNode } from "@/lib/qaMapTypes";

export type LinkResult = { to: string; relFrom: string; relTo: string };

/** 从模型输出提取 links JSON：剥代码栅栏 → 整体解析 → 锚定 "links" 非贪婪提取。
 *  不能用贪婪 \{[\s\S]*\}——推理型模型的 reasoning 里含杂字符会拼出非法 JSON（2026-11-11 实测）。 */
export function extractLinksJson(text: string): { links?: Array<{ to?: unknown; relFrom?: unknown; relTo?: unknown }> } | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* 继续尝试子串提取 */
  }
  const m = cleaned.match(/\{\s*"links"[\s\S]*?\]\s*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* 提取失败 */
    }
  }
  // 兑底：reasoning 被截断时逐个提取 link 对象（容忍尾部残缺）
  const links: Array<{ to: unknown; relFrom: unknown; relTo: unknown }> = [];
  for (const lm of cleaned.matchAll(/\{\s*"to"\s*:\s*"([^"]+)"\s*,\s*"relFrom"\s*:\s*"([^"]*)"\s*,\s*"relTo"\s*:\s*"([^"]*)"/g)) {
    links.push({ to: lm[1], relFrom: lm[2], relTo: lm[3] });
  }
  return links.length ? { links } : null;
}

const GENERIC_LABEL = /^(追问|追问延伸|延伸|相关|关联|依据|上文依据)$/;

/** 内容型标注清洗：截 20 字；纯通用词置空（不显示标注，不灌水） */
export function cleanLabel(v: unknown): string {
  const t = String(v ?? "").trim().slice(0, 20);
  return GENERIC_LABEL.test(t) ? "" : t;
}

/** 一次调用：连线判断 + 两端内容型标注（替代旧 decideParent + describeRelation 两次调用）。
 *  forcedTo = 追问场景固定连线目标；links 上限 3、to 校验、温度 0；失败/未配模型时：
 *  追问场景仍建边（标注留空），新话题不乱连。 */
export async function decideLinks(q: string, nodes: QaMapNode[], forcedTo?: string): Promise<LinkResult[]> {
  const FALLBACK: LinkResult[] = forcedTo ? [{ to: forcedTo, relFrom: "", relTo: "" }] : [];
  const s = getSettings();
  if (!isModelConfigured(s)) return FALLBACK;
  try {
    const cardList = nodes
      .map((n) => `${n.id}｜${n.title}｜${n.question.slice(0, 60)}｜${n.answer.replace(/\s+/g, " ").slice(0, 80)}`)
      .join("\n");
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: resolvePrompt("map_link", PROMPT_DEFAULTS.map_link) },
          {
            role: "user",
            content: `新问题：${q || "（图片提问）"}\n\n已有卡片：\n${cardList}${forcedTo ? `\n\n必须连至：${forcedTo}` : ""}`,
          },
        ],
        temperature: 0,
        max_tokens: 8000, // 推理型模型 reasoning_content 占预算且长度波动大，400/2000 都被思考吃光过（2026-11-11 实测）
      }),
    });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    const parsed =
      extractLinksJson(msg?.content ?? "") ?? extractLinksJson(msg?.reasoning_content ?? "");
    if (!parsed) {
      console.log("[map_link] JSON 解析失败 | content:", JSON.stringify(msg?.content ?? "").slice(0, 300));
      return FALLBACK;
    }
    const validIds = new Set(nodes.map((n) => n.id));
    const out: LinkResult[] = [];
    const seen = new Set<string>();
    for (const l of parsed.links ?? []) {
      const to = String(l.to ?? "");
      if (!validIds.has(to) || seen.has(to) || out.length >= 3) continue;
      if (forcedTo && to !== forcedTo) continue;
      seen.add(to);
      out.push({ to, relFrom: cleanLabel(l.relFrom), relTo: cleanLabel(l.relTo) });
    }
    return out.length ? out : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** 从模型输出提取指定顶层 key 的 JSON 对象（剥栅栏 → 整体解析 → 括号平衡提取）。
 *  推理型模型 reasoning 里杂字符多，贪婪正则会拼出非法 JSON——括号平衡扫描才是可靠解。 */
export function extractJsonObject(text: string, key: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    const whole = JSON.parse(cleaned) as Record<string, unknown>;
    if (whole && typeof whole === "object" && key in whole) return whole;
  } catch {
    /* 继续子串提取 */
  }
  const marker = `"${key}"`;
  const ki = cleaned.indexOf(marker);
  if (ki < 0) return null;
  // 从 key 前最近的 { 开始做括号平衡
  const start = cleaned.lastIndexOf("{", ki);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null; // 截断
}
