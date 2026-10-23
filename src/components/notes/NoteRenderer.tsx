"use client";

/**
 * 便签渲染器注册表：artifacts.type → 渲染组件。
 * report / outline / 未知类型返回 null，由调用方用普通 Markdown 渲染兜底。
 */
import dynamic from "next/dynamic";
import { Markdown } from "@/components/Markdown";
import type { QaCite } from "@/lib/qaCanvasTypes";

const MindMap = dynamic(() => import("./MindMap"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-neutral-400">导图加载中…</div>,
});
const MermaidView = dynamic(() => import("./MermaidView"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-neutral-400">流程图加载中…</div>,
});
const Flashcards = dynamic(() => import("./Flashcards"), { ssr: false });
const QuizView = dynamic(() => import("./QuizView"), { ssr: false });
const QACanvas = dynamic(() => import("./QACanvas"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-neutral-400">解答图加载中…</div>,
});

export default function NoteRenderer({
  type,
  content,
  onCite,
}: {
  type?: string | null;
  content: string;
  onCite?: (c: QaCite) => void;
}): React.ReactNode | null {
  switch (type) {
    case "mindmap":
      return <MindMap content={content} />;
    case "flowchart":
      return <MermaidView content={content} />;
    case "flashcards":
      return <Flashcards content={content} />;
    case "quiz":
      return <QuizView content={content} />;
    case "qa-canvas":
      return <QACanvas content={content} onCite={onCite} />;
    case "translation":
      return <TranslationView content={content} />;
    default:
      return null;
  }
}

/** 翻译产物（JSON）在工作台的轻量渲染：拼成可读的原文/译文 markdown */
function TranslationView({ content }: { content: string }) {
  let text = content;
  try {
    const doc = JSON.parse(content) as {
      sourceTitle?: string;
      model?: string;
      segments?: { page: number | null; heading?: string; src: string; trg: string }[];
    };
    if (Array.isArray(doc.segments)) {
      const parts = [`# ${doc.sourceTitle ?? ""} · 中文翻译`, "", `> 模型 ${doc.model ?? "-"} · 详细对照与下载请到「文献翻译」页`, ""];
      for (const s of doc.segments) {
        if (s.page != null) parts.push(`---`, `**第 ${s.page} 页${s.heading ? ` · ${s.heading}` : ""}**`, "", `<原文>\n${s.src}`, "", s.trg, "");
        else parts.push(`<原文>\n${s.src}`, "", s.trg, "");
      }
      text = parts.join("\n");
    }
  } catch {
    /* 解析失败按原文显示 */
  }
  return <Markdown text={text} />;
}
