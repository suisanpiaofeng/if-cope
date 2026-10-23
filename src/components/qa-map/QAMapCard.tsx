"use client";

/** 知识地图卡片：一次问答 = 一张卡；卡内可滚动看详情、点引用跳原文、从当前节点追问 */
import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Markdown } from "@/components/Markdown";
import type { QaMapNode } from "@/lib/qaMapTypes";

export type QaMapCardData = {
  node: QaMapNode;
  onFollowUp: (parentId: string, question: string) => void;
  onCite: (sourceId: number) => void;
  onArchive: (node: QaMapNode) => void;
  onDelete: (node: QaMapNode) => void;
  busy?: boolean;
};

export type QaMapRFNode = Node<QaMapCardData, "qaCard">;

export default function QAMapCard({ data, selected }: NodeProps<QaMapRFNode>) {
  const n = data.node;
  const [expanded, setExpanded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");

  function submit() {
    const q = text.trim();
    if (!q) return;
    setText("");
    setAsking(false);
    data.onFollowUp(n.id, q);
  }

  return (
    <div
      className={`w-[340px] rounded-lg border bg-white shadow-sm transition-shadow ${
        selected ? "border-neutral-900 shadow-md ring-1 ring-neutral-900" : "border-neutral-200"
      }`}
    >
      {/* 头部（拖动把手） */}
      <div className="card-head flex cursor-grab items-center gap-2 border-b border-neutral-100 px-3 py-2.5 active:cursor-grabbing">
        <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900">{n.title}</span>
        <span className="num shrink-0 text-[10px] text-neutral-400">
          {n.parentId ? `追问 · 第 ${n.round} 轮` : "提问"}
        </span>
        {data.busy && <span className="shrink-0 animate-pulse text-[10px] text-violet-500">生成中…</span>}
      </div>

      {/* 正文（可滚动） */}
      <div
        className={`nowheel overflow-y-auto px-3 py-2 transition-[max-height] ${
          expanded ? "max-h-[560px]" : "max-h-[240px]"
        }`}
      >
        <div className="text-[12px] leading-6">
          <Markdown text={n.answer} />
        </div>
      </div>

      {/* 引用 */}
      {(n.citations?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-neutral-100 px-3 py-1.5">
          {n.citations!.map((c) => (
            <button
              key={c.n}
              onClick={(e) => {
                e.stopPropagation();
                data.onCite(c.sourceId);
              }}
              title={`${c.title}${c.page != null ? ` 第${c.page}页` : ""}${c.quote ? `\n"${c.quote}"` : ""}`}
              className="nodrag rounded-sm border border-neutral-200 bg-neutral-50 px-1.5 py-px text-[9px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-900"
            >
              📎 {c.title.slice(0, 8)}{c.page != null ? ` p${c.page}` : ""}
            </button>
          ))}
        </div>
      )}

      {/* 底部操作 */}
      <div className="flex items-center gap-1 border-t border-neutral-100 px-3 py-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="nodrag rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
        >
          {expanded ? "收起" : "详情"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onCite(n.citations?.[0]?.sourceId ?? -1);
          }}
          disabled={!n.citations?.length}
          className="nodrag rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-30"
        >
          出处
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onArchive(n);
          }}
          className="nodrag rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
        >
          归档
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("删除这张卡片？（其追问卡片会接到上一级）")) data.onDelete(n);
          }}
          className="nodrag rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-red-50 hover:text-red-600"
        >
          删除
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setAsking((v) => !v);
          }}
          className="nodrag ml-auto rounded border border-neutral-900 bg-neutral-900 px-2 py-0.5 text-[10px] text-white hover:bg-neutral-700"
        >
          从这里追问
        </button>
      </div>

      {/* 追问小框（卡片下方弹出） */}
      {asking && (
        <div className="nodrag border-t border-neutral-100 bg-neutral-50 p-2">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`就「${n.title}」继续追问…（Enter 发送）`}
            rows={2}
            className="w-full resize-none rounded border border-neutral-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-neutral-400"
          />
          <div className="mt-1 flex justify-end gap-1.5">
            <button onClick={() => setAsking(false)} className="rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-700">
              取消
            </button>
            <button
              onClick={submit}
              disabled={!text.trim() || data.busy}
              className="rounded border border-neutral-900 bg-neutral-900 px-2.5 py-0.5 text-[10px] text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
