"use client";

/**
 * 便签渲染器注册表：artifacts.type → 渲染组件。
 * report / outline / 未知类型返回 null，由调用方用普通 Markdown 渲染兜底。
 */
import dynamic from "next/dynamic";
import type { QaCite } from "@/lib/qaCanvas";

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
    default:
      return null;
  }
}
