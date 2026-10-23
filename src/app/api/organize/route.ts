/**
 * 快捷功能「整理资源」：模型给资源归类方案（JSON）→ 建类目 → 资源归位。
 * 未配置模型时按资源 type 字段（课件/录音/笔记/网页…）兜底分组。
 */
import { NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `你是资料管理员。根据资源清单为学生整理资料库。只输出一个 JSON 对象，不要输出其他文字：
{"categories":[{"name":"类目名","sourceIds":[1,2]}]}
规则：
- 类目 2-6 个，名字用 2-6 个字的中文（如：课程课件、复习资料、实验与作业）
- 每份资源恰好归入一个类目，sourceIds 必须是清单里出现过的 id
- 归类依据：标题、类型、备注` as const;

type SourceRow = { id: number; title: string; type: string; note: string | null; category_id: number | null };

export async function POST() {
  const rows = db
    .prepare("SELECT id, title, type, note, category_id FROM sources ORDER BY id")
    .all() as SourceRow[];
  if (!rows.length) return NextResponse.json({ error: "资源库为空，无需整理" }, { status: 400 });

  const validIds = new Set(rows.map((r) => r.id));
  const list = rows
    .map((r) => `- id=${r.id}｜${r.title}｜类型:${r.type}${r.note ? `｜备注:${r.note}` : ""}`)
    .join("\n");

  let groups: { name: string; sourceIds: number[] }[] = [];
  const s = getSettings();

  if (isModelConfigured(s)) {
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `资源清单：\n${list}` },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `模型接口错误 HTTP ${res.status}` }, { status: 502 });
    const data = (await res.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices: Array<{ message: { content: string } }>;
    };
    recordUsage(
      "organize", s.chatModel,
      data.usage?.prompt_tokens ?? estimateTokens(list),
      data.usage?.completion_tokens ?? estimateTokens(data.choices?.[0]?.message?.content ?? "")
    );
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
    try {
      const parsed = JSON.parse(jsonText) as { categories?: { name: string; sourceIds: number[] }[] };
      groups = (parsed.categories ?? []).filter(
        (g) => g && typeof g.name === "string" && Array.isArray(g.sourceIds)
      );
    } catch {
      return NextResponse.json({ error: "模型输出无法解析为分类方案，请重试" }, { status: 502 });
    }
    // 只保留合法 id；模型漏掉的稍后按 type 兜底
    groups = groups.map((g) => ({ name: g.name.trim().slice(0, 12), sourceIds: g.sourceIds.filter((id) => validIds.has(id)) }));
    groups = groups.filter((g) => g.name && g.sourceIds.length > 0);
  }

  // 兜底：没配模型 / 模型漏掉的资源 → 按 type 分组
  const assigned = new Set(groups.flatMap((g) => g.sourceIds));
  const leftovers = rows.filter((r) => !assigned.has(r.id));
  if (!groups.length || leftovers.length) {
    const byType = new Map<string, number[]>();
    for (const r of leftovers) {
      const key = r.type && r.type !== "其他" ? r.type : "未归类整理";
      byType.set(key, [...(byType.get(key) ?? []), r.id]);
    }
    for (const [name, ids] of byType) {
      const existing = groups.find((g) => g.name === name);
      if (existing) existing.sourceIds.push(...ids);
      else groups.push({ name, sourceIds: ids });
    }
  }

  // 落库：建类目 + 归位
  const now = Date.now();
  const catIdByName = new Map<string, number>();
  for (const c of db.prepare("SELECT id, name FROM categories").all() as { id: number; name: string }[]) {
    catIdByName.set(c.name, c.id);
  }
  const applied: { name: string; count: number }[] = [];
  const move = db.prepare("UPDATE sources SET category_id = ? WHERE id = ?");
  const mkCat = db.prepare("INSERT INTO categories (name, created_at) VALUES (?, ?)");
  for (const g of groups) {
    let catId = catIdByName.get(g.name);
    if (catId == null) {
      catId = Number(mkCat.run(g.name, now).lastInsertRowid);
      catIdByName.set(g.name, catId);
    }
    for (const id of g.sourceIds) move.run(catId, id);
    applied.push({ name: g.name, count: g.sourceIds.length });
  }

  return NextResponse.json({
    ok: true,
    groups: applied,
    model: isModelConfigured(s) ? s.chatModel : "fallback(按类型)",
  });
}
