/**
 * 逐课笔记 worker（规格 §4.1）：
 * 原料 = 该课时 AI 字幕 segments（前端经反代现拉）或手动粘贴文本；
 * LLM 一次调用产出四节结构化 Markdown（带 [mm:ss] 时间锚）；
 * 未配置模型降级 mock（沿本项目纪律，UI 链路可完整演示）。
 */
import db, { getSettings, isModelConfigured, recordUsage } from "@/lib/db";
import { estimateTokens } from "@/lib/embed";
import { modelEndpoint, modelHeaders } from "@/lib/modelGateway";
import { getLesson, getLessonNote, saveLessonNote, setLessonNoteStatus } from "./store";
import type { TranscriptSegment } from "./types";

/** 转写输入上限：超过截断（保头尾，LLM 上下文纪律） */
const MAX_INPUT_CHARS = 40000;

/** prompt 契约（渲染器/阅读视图依赖这四节，改动需同步前端） */
const NOTE_PROMPT = `你是大学课程笔记助手。根据本节课的带时间戳转写稿，输出结构化中文课堂笔记（markdown），严格包含以下四节，不要输出额外解释：
## 本节要点
分条列出课堂讲授的核心内容，重要处标注转写稿里出现的时间锚 [mm:ss]（只能用转写稿中真实出现的时间，不得编造）。
## 关键概念
本节出现的新概念/术语，每条「概念：解释」一行，解释只用转写稿内容。
## 公式与结论
本节给出的公式、定理、结论（若无则写「本节无」）。
## 疑难点
老师强调的易错点、难点、作业考试提示（若无则写「本节无」）。
只使用转写稿内容，不要编造。`;

/** 转写段 → 带时间戳文本（纯函数，独立验证） */
export function assembleTranscriptText(segments: TranscriptSegment[]): string {
  const lines = segments
    .filter((s) => s.text.trim())
    .map((s) => `[${fmtTs(s.start)}] ${s.text.trim()}`);
  let text = lines.join("\n");
  if (text.length > MAX_INPUT_CHARS) {
    const head = text.slice(0, Math.floor(MAX_INPUT_CHARS * 0.7));
    const tail = text.slice(-Math.floor(MAX_INPUT_CHARS * 0.25));
    text = `${head}\n\n…（转写过长已截断，保留首尾）…\n\n${tail}`;
  }
  return text;
}

function fmtTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** 生成逐课笔记：成功落库 + done；失败留 failed（不写空笔记，规格 Review Focus #4） */
export async function generateLessonNote(
  lessonId: number,
  input: { segments?: TranscriptSegment[]; manualText?: string }
): Promise<{ ok: boolean; error?: string }> {
  const lesson = getLesson(lessonId);
  if (!lesson) return { ok: false, error: "课时不存在" };

  const hasSegments = Array.isArray(input.segments) && input.segments.some((s) => s.text.trim());
  const manual = (input.manualText ?? "").trim();
  if (!hasSegments && !manual) {
    return { ok: false, error: "先同步字幕或粘贴课堂文本" };
  }

  const transcriptText = hasSegments
    ? assembleTranscriptText(input.segments!)
    : manual;

  const s = getSettings();

  // 未配置模型 → mock（演示链路，格式与契约一致）
  if (!isModelConfigured(s)) {
    const content = mockNote(lesson.title, transcriptText);
    saveLessonNote(lessonId, content, "mock", getLessonNote(lessonId)?.source_id ?? null);
    setLessonNoteStatus(lessonId, "done");
    recordUsage("note", "mock-lesson", estimateTokens(transcriptText), estimateTokens(content));
    return { ok: true };
  }

  try {
    const res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify({
        model: s.chatModel,
        temperature: 0.3,
        messages: [
          { role: "system", content: NOTE_PROMPT },
          { role: "user", content: `课时：${lesson.title}\n\n带时间戳转写稿：\n${transcriptText}` },
        ],
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return failNote(lessonId, `模型接口错误 HTTP ${res.status}：${msg.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return failNote(lessonId, "模型返回了空内容");
    saveLessonNote(lessonId, content, s.chatModel, getLessonNote(lessonId)?.source_id ?? null);
    setLessonNoteStatus(lessonId, "done");
    recordUsage(
      "note",
      s.chatModel,
      data.usage?.prompt_tokens ?? estimateTokens(transcriptText),
      data.usage?.completion_tokens ?? estimateTokens(content)
    );
    return { ok: true };
  } catch (e) {
    return failNote(lessonId, e instanceof Error ? e.message : "笔记生成失败");
  }
}

function failNote(lessonId: number, error: string): { ok: false; error: string } {
  setLessonNoteStatus(lessonId, "failed", error);
  return { ok: false, error };
}

/** 未配置模型时的演示笔记（四节契约齐全，时间锚取转写前几段） */
function mockNote(title: string, transcriptText: string): string {
  const lines = transcriptText.split("\n").filter(Boolean).slice(0, 6);
  const anchors = lines.map((l) => `- ${l.slice(0, 60)}…`).join("\n");
  return [
    `## 本节要点`,
    `> 未配置模型，以下为《${title}》演示笔记（配置模型后为真实生成）。`,
    anchors || "- （转写为空，演示占位）",
    ``,
    `## 关键概念`,
    `- 概念一：见要点第一条`,
    `- 概念二：见要点第二条`,
    ``,
    `## 公式与结论`,
    `- 演示占位`,
    ``,
    `## 疑难点`,
    `- 演示占位`,
  ].join("\n");
}
