"use client";

/** 知识地图卡片：一次问答 = 一张卡；可拖边框调大小、从当前节点追问、引用跳右侧预览 */
import { useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Markdown } from "@/components/Markdown";
import type { QaMapNode } from "@/lib/qaMapTypes";

export type QaMapCardData = {
  node: QaMapNode;
  onFollowUp: (parentId: string, question: string) => void;
  onCite: (sourceId: number) => void;
  onDelete: (node: QaMapNode) => void;
  onResize: (id: string, w: number, h: number) => void;
  onResizeEnd?: (id: string) => void;
  busy?: boolean;
};

export type QaMapRFNode = Node<QaMapCardData, "qaCard">;

const MIN_W = 260;
const MAX_W = 720;
const MIN_H = 180;
const MAX_H = 900;

export default function QAMapCard({ data, selected }: NodeProps<QaMapRFNode>) {
  const n = data.node;
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // 拖右下角调大小
  useEffect(() => {
    function move(e: MouseEvent) {
      const r = resizeRef.current;
      if (!r) return;
      data.onResize(
        n.id,
        Math.min(MAX_W, Math.max(MIN_W, r.w + (e.clientX - r.x))),
        Math.min(MAX_H, Math.max(MIN_H, r.h + (e.clientY - r.y)))
      );
    }
    function up() {
      if (resizeRef.current) data.onResizeEnd?.(n.id);
      resizeRef.current = null;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [data, n.id]);

  function submit() {
    const q = text.trim();
    if (!q) return;
    setText("");
    setAsking(false);
    data.onFollowUp(n.id, q);
  }

  return (
    <div
      className={`group relative rounded-lg border bg-white shadow-sm transition-shadow ${
        selected ? "border-neutral-900 shadow-md ring-1 ring-neutral-900" : "border-neutral-200"
      }`}
      style={{ width: n.w ?? 340, height: n.h ?? 280 }}
    >
      {/* 连接锚点（React Flow 边的挂点） */}
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-neutral-400" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-neutral-500" />

      <div className="flex h-full flex-col">
        {/* 头部（拖动把手） */}
        <div className="card-head flex cursor-grab items-center gap-2 border-b border-neutral-100 px-3 py-2 active:cursor-grabbing">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900">{n.title}</span>
          <span className="num shrink-0 text-[10px] text-neutral-400">
            {n.parentId ? `追问 · 第 ${n.round} 轮` : "话题"}
          </span>
          {data.busy && <span className="shrink-0 animate-pulse text-[10px] text-violet-500">生成中…</span>}
        </div>

        {/* 正文（填满卡片，内部滚动） */}
        <div className="nowheel min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="text-[12px] leading-6">
            <Markdown text={n.answer} />
          </div>
        </div>

        {/* 引用（仅真正被回答标注过的；没有就不显示） */}
        {(n.citations?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-neutral-100 px-3 py-1.5">
            {n.citations!.map((c) => (
              <button
                key={c.n}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onCite(c.sourceId);
                }}
                title={`${c.title}${c.page != null ? ` 第${c.page}页` : ""}${c.quote ? `\n"${c.quote}"` : ""}（在右侧预览）`}
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
      </div>

      {/* 追问小框（卡片下方弹出） */}
      {asking && (
        <div
          className="nodrag absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
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
            className="w-full resize-none rounded border border-neutral-200 px-2 py-1.5 text-[11px] outline-none focus:border-neutral-400"
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

      {/* 右下角调大小把手 */}
      <div
        className="nodrag absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        title="拖动调整卡片大小"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resizeRef.current = { x: e.clientX, y: e.clientY, w: n.w ?? 340, h: n.h ?? 280 };
          document.body.style.cursor = "nwse-resize";
        }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-neutral-300">
          <path d="M14 8v6h-6M14 2v0" stroke="currentColor" fill="none" strokeWidth="1.5" />
          <path d="M14 8L8 14M14 2L2 14" stroke="currentColor" fill="none" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
