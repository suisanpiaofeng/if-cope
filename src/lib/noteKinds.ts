/** 便签类型定义（客户端安全：只含数据，供 ChatPanel / 渲染器 / 服务端生成共用） */

export type NoteKind = "report" | "mindmap" | "flowchart" | "outline" | "quiz";

export type NoteKindMeta = {
  kind: NoteKind;
  label: string;
  icon: string;
  /** 产物文件扩展名 */
  ext: string;
};

export const NOTE_KINDS: NoteKindMeta[] = [
  { kind: "report", label: "复习笔记", icon: "📝", ext: "md" },
  { kind: "mindmap", label: "思维导图", icon: "🧠", ext: "md" },
  { kind: "flowchart", label: "流程图", icon: "📊", ext: "md" },
  { kind: "outline", label: "大纲", icon: "📋", ext: "md" },
  { kind: "quiz", label: "测验", icon: "❓", ext: "md" },
];

export function noteKindMeta(kind: string | null | undefined): NoteKindMeta {
  return NOTE_KINDS.find((k) => k.kind === kind) ?? NOTE_KINDS[0];
}

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && NOTE_KINDS.some((k) => k.kind === v);
}
