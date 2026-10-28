/**
 * 期末复习手册 worker（规格 §4.2）：
 * 原料 = 该课程全部 note_status=done 的逐课笔记（按 seq 排序）；
 * LLM 一次调用产出：按主题重组（跨讲次合并）+ 必考/常考/了解分层 + 考点课次索引；
 * 落 classroom_digests + 回流 RAG；可重生成（幂等替换）。
 */
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { getCourse, getDigest, listLessons, saveDigest } from "./store";
import { getLessonNote } from "./store";
import { registerNoteAsSource } from "./rag";

/** 输入上限：超量取最近 30 份逐课笔记并在文首注记 */
const MAX_INPUT_CHARS = 60000;
const MAX_NOTES = 30;

/** prompt 契约（阅读视图依赖这些节，改动需同步前端） */
const DIGEST_PROMPT = `你是大学期末复习助手。以下是某门课逐节课的课堂笔记（按上课顺序），请生成一份**贯穿整门课**的期末复习手册（markdown），严格包含以下结构，只使用笔记内容不要编造：
# 课程名 期末复习手册
## 复习总览
一段话概括整门课的脉络与核心主线。
## 主题复习
**按主题/知识点重组**（不要按上课时间线）：把不同课次讲到的同一知识点合并成一节，每节含要点与「出现于：第x、y讲」的课次索引。用 ### 分主题。
## 考点分层
### 必考
往年高频/老师反复强调的内容（依据笔记中的强调信号：老师说必考、期中/期末考过、反复板书等；没有明确信号时按内容重要性判断并注明「依据内容重要性」）。
### 常考
### 了解
## 考前速查
公式、定理、结论的清单（表格或列表）。`;

/** 汇总逐课笔记为输入文本（纯函数，独立验证） */
export function assembleCourseNotes(
  notes: { seq: number; title: string; contentMd: string }[]
): { text: string; truncated: boolean } {
  const picked = notes.slice(-MAX_NOTES);
  const parts = picked.map((n) => `【第${n.seq}讲 ${n.title}】\n${n.contentMd}`);
  let text = parts.join("\n\n");
  let truncated = notes.length > MAX_NOTES;
  if (text.length > MAX_INPUT_CHARS) {
    text = text.slice(0, MAX_INPUT_CHARS) + "\n\n…（内容过长已截断）";
    truncated = true;
  }
  return { text, truncated };
}

/** 生成期末手册：0 份笔记报错；成功落库 + 回流 */
export async function generateDigest(
  courseId: number
): Promise<{ ok: boolean; error?: string }> {
  const course = getCourse(courseId);
  if (!course) return { ok: false, error: "课程不存在" };

  const doneLessons = listLessons(courseId).filter((l) => l.note_status === "done");
  const notes: { seq: number; title: string; contentMd: string }[] = [];
  for (const l of doneLessons) {
    const n = getLessonNote(l.id);
    if (n?.content_md) notes.push({ seq: l.seq, title: l.title, contentMd: n.content_md });
  }
  if (notes.length === 0) return { ok: false, error: "先为课时生成逐课笔记" };

  const { text, truncated } = assembleCourseNotes(notes);
  const s = getSettings();

  let content: string;
  let model: string;
  if (!isModelConfigured(s)) {
    content = mockDigest(course.name, notes);
    model = "mock";
    recordUsage("digest", "mock-digest", estimateTokens(text), estimateTokens(content));
  } else {
    try {
      const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
        method: "POST",
        headers: modelHeaders(s.apiKey),
        body: JSON.stringify({
          model: s.chatModel,
          temperature: 0.3,
          messages: [
            { role: "system", content: DIGEST_PROMPT },
            {
              role: "user",
              content: `课程：${course.name}${truncated ? "（注：笔记输入有截断，覆盖不完整已在生成物中体现）" : ""}\n\n逐课笔记：\n${text}`,
            },
          ],
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        return { ok: false, error: `模型接口错误 HTTP ${res.status}：${msg.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices: Array<{ message: { content: string } }>;
      };
      content = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) return { ok: false, error: "模型返回了空内容" };
      model = s.chatModel;
      recordUsage(
        "digest",
        s.chatModel,
        data.usage?.prompt_tokens ?? estimateTokens(text),
        data.usage?.completion_tokens ?? estimateTokens(content)
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "手册生成失败" };
    }
  }

  // 落库 + 回流（回流失败不连坐手册）
  const old = getDigest(courseId);
  const out = await registerNoteAsSource({
    title: `${course.name}·期末复习手册`,
    contentMd: content,
    oldSourceId: old?.source_id ?? null,
  }).catch(
    (e): { ok: boolean; sourceId?: number; error?: string } => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  );
  saveDigest(courseId, content, model, out.sourceId ?? old?.source_id ?? null);
  return { ok: true };
}

/** 未配置模型时的演示手册（结构契约齐全） */
function mockDigest(
  courseName: string,
  notes: { seq: number; title: string }[]
): string {
  const topics = notes.slice(0, 5).map((n) => `- ${n.title}（出现于：第${n.seq}讲）`).join("\n");
  return [
    `# ${courseName} 期末复习手册`,
    ``,
    `> 未配置模型，以下为演示手册（覆盖 ${notes.length} 讲；配置模型后为真实重组）。`,
    ``,
    `## 复习总览`,
    `本课程共 ${notes.length} 讲，演示占位。`,
    ``,
    `## 主题复习`,
    `### 主题一（演示）`,
    topics || "- 暂无",
    ``,
    `## 考点分层`,
    `### 必考`,
    `- 演示占位（依据内容重要性）`,
    `### 常考`,
    `- 演示占位`,
    `### 了解`,
    `- 演示占位`,
    ``,
    `## 考前速查`,
    `- 演示占位`,
  ].join("\n");
}

/** 读手册（含来源笔记数，供 UI 显示覆盖范围） */
export function getDigestWithMeta(courseId: number): {
  digest: ReturnType<typeof getDigest>;
  noteCount: number;
} {
  const noteCount = db
    .prepare("SELECT COUNT(*) c FROM classroom_lessons WHERE course_id = ? AND note_status = 'done'")
    .get(courseId) as { c: number };
  return { digest: getDigest(courseId), noteCount: noteCount.c };
}
