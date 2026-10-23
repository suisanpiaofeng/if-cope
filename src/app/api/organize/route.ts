/**
 * 快捷功能「整理资源」：复用优先的智能归类。
 *
 * 策略（参考 Gmail 标签/Notion 自动打标一类"闭集分类 + 逃生口"方案，和 seu-wiki 的 identityKey 去重思路）：
 * 1. 复用优先：把现有类目（含成员标题示例）给模型，要求优先归入已有类目
 * 2. 新建门槛：新类目需 ≥2 份资源才生效；单个资源留在原地不动；每次最多新建 MAX_NEW 个
 * 3. 同义合并：新名字与已有类目相似（规范化包含 / 二元组 Dice）→ 并入已有类目
 * 4. 空类目清理：整理后删除空类目（0 资源 0 产物），结果里如实汇报
 * 未配置模型时：按资源 type 字段与已有类目做同义匹配，匹配不上就不动。
 */
import { NextResponse } from "next/server";
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_NEW = 2; // 每次整理允许新建的类目上限
const MIN_SUPPORT = 2; // 新类目至少需要的资源数

const SYSTEM = `你是资料管理员，帮学生把资源归入资料库的类目。只输出一个 JSON 对象，不要输出其他文字：
{"assignments":[{"sourceId":1,"categoryId":5},{"sourceId":2,"newName":"机器学习"}]}
规则：
- 每份资源恰好一条 assignment，sourceId 必须来自清单
- 优先复用已有类目：只要说得过去就归入，不要轻易发明新类目
- categoryId 必须来自「已有类目清单」里的 id
- 仅当所有已有类目都不合适时才用 newName 建议新类目（2-6 个字的中文），并尽量让多个资源共享同一个新类目名
- 归类依据：标题、类型、备注与已有类目的主题契合度` as const;

type SourceRow = { id: number; title: string; type: string; note: string | null; category_id: number | null };
type CatRow = { id: number; name: string };

/** 名称规范化：去空白/标点/常见后缀，便于同义比对 */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_/·、,，.。()（）【】\[\]]/g, "")
    .replace(/(资料|文档|文件|汇总|整理|区|类)$/g, "");
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 同义相似度：规范化包含 → 1，否则二元组 Dice 系数 */
function nameSimilarity(a: string, b: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size || 1);
}

export async function POST() {
  const sources = db
    .prepare("SELECT id, title, type, note, category_id FROM sources ORDER BY id")
    .all() as SourceRow[];
  if (!sources.length) return NextResponse.json({ error: "资源库为空，无需整理" }, { status: 400 });

  const cats = db.prepare("SELECT id, name FROM categories WHERE pinned = 0 ORDER BY id").all() as CatRow[];
  const catMembers = new Map<number, string[]>();
  for (const s of sources) {
    if (s.category_id != null) catMembers.set(s.category_id, [...(catMembers.get(s.category_id) ?? []), s.title]);
  }
  const catDesc = cats
    .map((c) => {
      const titles = (catMembers.get(c.id) ?? []).slice(0, 8).join("、");
      return `- id=${c.id}「${c.name}」${titles ? `（现有：${titles}…）` : "（暂无资源）"}`;
    })
    .join("\n") || "（还没有任何类目）";

  const validIds = new Set(sources.map((s) => s.id));
  const validCats = new Set(cats.map((c) => c.id));
  const list = sources
    .map((s) => `- id=${s.id}｜${s.title}｜类型:${s.type}${s.note ? `｜备注:${s.note}` : ""}${s.category_id != null ? `｜当前类目:${cats.find((c) => c.id === s.category_id)?.name ?? s.category_id}` : "｜当前:未归类"}`)
    .join("\n");

  type Assign = { sourceId: number; categoryId?: number; newName?: string };
  let assigns: Assign[] = [];
  let modelLabel = "fallback(按类型同义匹配)";
  const s = getSettings();

  if (isModelConfigured(s)) {
    modelLabel = s.chatModel;
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `已有类目清单：\n${catDesc}\n\n资源清单：\n${list}` },
        ],
        temperature: 0.1,
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
      const parsed = JSON.parse(jsonText) as { assignments?: Assign[] };
      assigns = parsed.assignments ?? [];
    } catch {
      return NextResponse.json({ error: "模型输出无法解析为分类方案，请重试" }, { status: 502 });
    }
  } else {
    // 兜底：type 与已有类目做同义匹配，匹配不上就不动
    for (const src of sources) {
      let best: { id: number; score: number } | null = null;
      for (const c of cats) {
        const score = nameSimilarity(src.type, c.name);
        if (score >= 0.5 && (!best || score > best.score)) best = { id: c.id, score };
      }
      if (best) assigns.push({ sourceId: src.id, categoryId: best.id });
    }
  }

  // ── 校验与整形（模型输出不可全信，全部过闸门） ──
  const byId = new Map(sources.map((s) => [s.id, s]));
  const clean: Assign[] = [];
  for (const a of assigns) {
    const src = byId.get(Number(a.sourceId));
    if (!src) continue;
    if (a.categoryId != null && validCats.has(Number(a.categoryId))) {
      clean.push({ sourceId: src.id, categoryId: Number(a.categoryId) });
      continue;
    }
    const name = (a.newName ?? "").trim().slice(0, 12);
    if (name) clean.push({ sourceId: src.id, newName: name });
    // 既无合法 categoryId 又无 newName → 丢弃（留在原地）
  }

  // 同义合并：newName 与已有类目相似 → 直接用已有类目
  for (const a of clean) {
    if (!a.newName) continue;
    let best: { id: number; score: number } | null = null;
    for (const c of cats) {
      const score = nameSimilarity(a.newName, c.name);
      if (score >= 0.6 && (!best || score > best.score)) best = { id: c.id, score };
    }
    if (best) {
      a.categoryId = best.id;
      delete a.newName;
    }
  }

  // 新建门槛：按 newName 聚组，≥ MIN_SUPPORT 且不超过 MAX_NEW 个才建；
  // 多余的新名字（超上限）里的资源并入最相似的已接受新名字；仍不行就留在原地
  const newNameGroups = new Map<string, number[]>();
  for (const a of clean) {
    if (a.newName) newNameGroups.set(a.newName, [...(newNameGroups.get(a.newName) ?? []), a.sourceId]);
  }
  const accepted = [...newNameGroups.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .filter(([, ids]) => ids.length >= MIN_SUPPORT)
    .slice(0, MAX_NEW)
    .map(([name]) => name);
  for (const a of clean) {
    if (!a.newName) continue;
    if (accepted.includes(a.newName)) continue;
    // 找最相似的已接受新名字
    let best: { name: string; score: number } | null = null;
    for (const name of accepted) {
      const score = nameSimilarity(a.newName, name);
      if (score >= 0.5 && (!best || score > best.score)) best = { name, score };
    }
    if (best) {
      a.newName = best.name;
    } else {
      delete a.newName; // 不动它，留在原类目
    }
  }

  // ── 落库 ──
  const now = Date.now();
  const catIdByName = new Map(cats.map((c) => [c.name, c.id] as const));
  const mkCat = db.prepare("INSERT INTO categories (name, created_at) VALUES (?, ?)");
  const move = db.prepare("UPDATE sources SET category_id = ? WHERE id = ? AND (category_id IS NOT ?)");
  let moved = 0;
  const created: string[] = [];
  const reused = new Set<number>();

  for (const a of clean) {
    const src = byId.get(a.sourceId)!;
    let target: number;
    if (a.categoryId != null) {
      target = a.categoryId;
      reused.add(target);
    } else if (a.newName) {
      let id = catIdByName.get(a.newName);
      if (id == null) {
        id = Number(mkCat.run(a.newName, now).lastInsertRowid);
        catIdByName.set(a.newName, id);
        created.push(a.newName);
      }
      target = id;
    } else {
      continue;
    }
    const info = move.run(target, src.id, src.category_id);
    moved += info.changes;
  }

  // ── 空类目清理（0 资源 0 产物），含历史上遗留的空壳 ──
  const empty = db
    .prepare(
      `SELECT c.id, c.name FROM categories c
       WHERE c.pinned = 0
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.category_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.category_id = c.id)`
    )
    .all() as CatRow[];
  const delCat = db.prepare("DELETE FROM categories WHERE id = ?");
  for (const c of empty) delCat.run(c.id);

  return NextResponse.json({
    ok: true,
    model: modelLabel,
    moved,
    reused: reused.size,
    created,
    cleaned: empty.map((c) => c.name),
  });
}
