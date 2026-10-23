"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/types";
import { DND_MIME, readDnd } from "@/lib/dnd";

type Thread = { id: number; title: string; created_at: number; message_count?: number };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };
type Citation = { n: number; sourceId: number; title: string; page: number | null; quote: string };
type PanelView = "home" | "chat" | "all";

/** 工具调用活动（AI 正在操作应用时的实时展示） */
type LiveTool = { name: string; phase: "run" | "done" | "error"; detail?: string };
const TOOL_LABELS: Record<string, string> = {
  list_library: "查看资料库",
  read_source: "读取资料全文",
  move_source: "移动资料",
  move_artifact: "移动产物",
  create_category: "新建类目",
  generate_summary: "生成复习笔记",
};

/** 同一工具的 start 后到 done/error 时原位替换，否则追加 */
function mergeTool(list: LiveTool[], ev: { name: string; phase: "start" | "done" | "error"; detail?: string }): LiveTool[] {
  const phase = ev.phase === "start" ? "run" : ev.phase;
  const idx = list.findIndex((t) => t.name === ev.name && t.phase === "run");
  const item: LiveTool = { name: ev.name, phase, detail: ev.detail };
  if (ev.phase !== "start" && idx >= 0) {
    const n = [...list];
    n[idx] = item;
    return n;
  }
  return [...list, item];
}

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 3600_000) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)} 小时前`;
  return `${Math.round(d / 86400_000)} 天前`;
}

function mapMsgs(data: { messages?: { role: string; content: string; citations: string | null }[] }): Message[] {
  return (data.messages ?? []).map((m) => ({
    role: m.role as Message["role"],
    content: m.content,
    citations: m.citations ? (JSON.parse(m.citations) as Citation[]) : undefined,
  }));
}

/** 最右对话栏：主界面（最近 3 条）↔ 对话视图 ↔ 全部对话；回答进行中回退不中断 */
export default function ChatPanel({
  sources, selected, onSelectionReset,
}: {
  sources: Source[];
  /** 已勾选的资源（来自文件栏复选框） */
  selected: Set<number>;
  /** 发送后重置全部选中 */
  onSelectionReset: () => void;
}) {
  const ready = sources.filter((s) => s.status === "ready");
  // 拖入对话框的文件（与勾选取并集作为上下文）
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [dropOver, setDropOver] = useState(false);
  // 实际参与检索的资源：勾选 ∪ 拖入；两者都空 → 全部资源
  const hasFilter = selected.size > 0 || dropped.size > 0;
  const context = hasFilter
    ? ready.filter((s) => selected.has(s.id) || dropped.has(s.id))
    : ready;
  const totalChunks = context.reduce((n, s) => n + s.chunk_count, 0);
  const [view, setView] = useState<PanelView>("home");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 正在运行的任务：即使回到主界面/打开别的会话，流式仍在后台继续
  const [runThread, setRunThread] = useState<number | null>(null);
  const [live, setLive] = useState<{ question: string; content: string; citations: Citation[]; tools: LiveTool[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [citation, setCitation] = useState<{ title: string; page: number | null; chunks: { page: number | null; text: string }[]; quote: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<number | null>(null);
  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);

  const loadThreads = () => {
    fetch("/api/chat").then((r) => r.json()).then((d) => setThreads(d.threads ?? []));
  };
  useEffect(() => { loadThreads(); }, []);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setModel(d.hasKey && d.chatModel ? d.chatModel : null));
  }, []);

  const liveOpen = streaming && runThread === threadId && !!live;

  // 对话视图里滚动跟随；主界面/全部对话没有消息区，ref 为空自动跳过
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, live, view]);

  async function openThread(id: number) {
    setView("chat"); setError(null);
    setThreadId(id);
    threadIdRef.current = id; // 立刻同步，避免流式收尾时的竞态
    try {
      const res = await fetch(`/api/chat?threadId=${id}`);
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      const data = await res.json();
      if (threadIdRef.current === id) setMessages(mapMsgs(data));
    } catch (e) {
      if (threadIdRef.current === id) {
        setMessages([]);
        setError(`会话加载失败：${e instanceof Error ? e.message : "网络错误"}，可点 ← 返回后重试`);
      }
    }
  }

  // 删除会话（运行中的任务不允许删）
  async function removeThread(id: number) {
    if (streaming && runThread === id) return;
    const res = await fetch(`/api/chat?threadId=${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (threadId === id) {
      setView("home");
      setThreadId(null); threadIdRef.current = null;
      setMessages([]);
    }
  }

  // 返回主界面：回到"新对话"状态；正在运行的任务继续跑
  function backHome() {
    setView("home");
    setThreadId(null); threadIdRef.current = null;
    setMessages([]); setError(null);
  }

  async function ask() {
    const question = input.trim();
    if (!question || streaming) return;
    if (context.length === 0) { setError(hasFilter ? "所选文件中还没有可检索的资源" : "还没有可检索的资源，先上传并解析成功"); return; }
    setError(null);
    setInput("");
    setView("chat");
    setStreaming(true);
    setRunThread(threadId); // 新对话时为 null，与 threadId 一致
    setLive({ question, content: "", citations: [], tools: [] });
    // 开启一段工作：全部选中状态回归初始（勾选清空、拖入清空）
    onSelectionReset();
    setDropped(new Set());
    let tid = threadId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, sourceIds: context.map((s) => s.id), question }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "请求失败"); }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.threadId) {
            tid = evt.threadId;
            setThreadId(evt.threadId); threadIdRef.current = evt.threadId;
            setRunThread(evt.threadId);
            loadThreads();
          }
          if (evt.citations) setLive((l) => (l ? { ...l, citations: evt.citations } : l));
          if (evt.tool) setLive((l) => (l ? { ...l, tools: mergeTool(l.tools, evt.tool) } : l));
          if (evt.delta) setLive((l) => (l ? { ...l, content: l.content + evt.delta } : l));
          if (evt.error) setError(evt.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // 收尾：刷新列表，并把落库的最终消息拉回（仅当还停在这个会话）
      setStreaming(false); setRunThread(null); setLive(null);
      loadThreads();
      if (tid && threadIdRef.current === tid) {
        const res = await fetch(`/api/chat?threadId=${tid}`);
        const data = await res.json();
        if (threadIdRef.current === tid) setMessages(mapMsgs(data));
      }
    }
  }

  async function openCitation(c: Citation) {
    const res = await fetch(`/api/lookup?sourceId=${c.sourceId}&page=${c.page}`);
    const data = await res.json();
    setCitation({ title: data.title, page: c.page, chunks: data.chunks, quote: c.quote });
  }

  // 拖入对话框：文件成为本次上下文（与勾选取并集）
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropOver(false);
    const payload = readDnd(e.dataTransfer);
    if (payload?.kind === "source") {
      setDropped((prev) => new Set([...prev, ...payload.ids]));
    }
  }

  function removeDropped(id: number) {
    setDropped((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  const droppedList = sources.filter((s) => dropped.has(s.id));
  const droppedChunks = droppedList.reduce((n, s) => n + s.chunk_count, 0);

  // 渲染用消息：进行中的会话追加“用户提问 + 实时回答”覆盖层
  // （服务端在流开始前就存了用户消息，重进会话时已带它，这里按内容去重）
  const shown = (() => {
    if (!liveOpen || !live) return messages;
    const last = messages[messages.length - 1];
    const hasUser = last && last.role === "user" && last.content === live.question;
    const base = hasUser ? messages : [...messages, { role: "user" as const, content: live.question }];
    return [...base, { role: "assistant" as const, content: live.content, citations: live.citations }];
  })();

  const isRunning = (id: number) => streaming && runThread === id;
  const currentTitle = threads.find((t) => t.id === threadId)?.title ?? "新对话";

  // 底部输入条（主界面 / 对话视图共用）
  const inputBar = (
    <>
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      <div className="border-t border-neutral-100 px-4 py-3"
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)}
        onDrop={handleDrop}
      >
        {/* 拖入的文件：成为上下文的一部分 */}
        {(droppedList.length > 0 || (hasFilter && dropped.size === 0 && selected.size > 0)) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {droppedList.map((s) => (
              <span key={s.id}
                className="flex max-w-[160px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                <span className="truncate">{s.title}</span>
                <button onClick={() => removeDropped(s.id)} className="shrink-0 text-violet-400 hover:text-violet-700" title="移出">×</button>
              </span>
            ))}
            {droppedList.length > 0 && <span className="num self-center text-[10px] text-neutral-400">+{droppedChunks} 块</span>}
          </div>
        )}
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-neutral-400">
          <span className="num shrink-0">
            上下文 {context.length} 份 · {totalChunks} 块
            {hasFilter && <span className="ml-1 text-violet-500">（已选）</span>}
            {!hasFilter && <span className="ml-1">（全部资源）</span>}
          </span>
          <div className="flex min-w-0 items-center gap-1">
            <span className="mono shrink-0 rounded border border-neutral-200 px-1.5 py-0.5">{model ?? "未配置"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); }
            }}
            placeholder="输入你的问题…"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button onClick={ask} disabled={streaming || !input.trim()} aria-label="发送"
            className={`self-end rounded-lg p-2.5 text-white transition-colors ${
              dropOver ? "bg-violet-600" : "bg-neutral-900 hover:bg-neutral-700"
            } disabled:opacity-40`}>
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
              <path d="M1.7 8 1 2.5c-.05-.4.36-.7.73-.53l12.6 5.2c.4.17.4.73 0 .9l-12.6 5.2a.58.58 0 0 1-.73-.53L1.7 8Zm0 0h4.8m-4.8 0 6.3 1.7" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-white">
      {/* 主界面：最近 3 条对话 */}
      {view === "home" && (
        <>
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-semibold">对话</h2>
            <button onClick={() => setView("all")} className="text-xs text-neutral-400 hover:text-neutral-900">
              查看全部对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {threads.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <svg className="h-9 w-9 text-neutral-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <rect x="4" y="7" width="16" height="11" rx="2.5" /><path d="M9 11h.01M15 11h.01M9.5 14.5h5" />
                </svg>
                <p className="mt-3 text-sm font-medium text-neutral-500">还没有对话</p>
                <p className="mt-1 text-xs leading-5 text-neutral-400">在下方输入问题，<br />基于勾选或拖入的资料开始提问</p>
              </div>
            ) : (
              <>
                <p className="px-1 pb-2 text-[11px] text-neutral-400">最近对话</p>
                <div className="space-y-2">
                  {threads.slice(0, 3).map((t) => (
                    <div key={t.id} className="group relative">
                      <button onClick={() => openThread(t.id)}
                        className="block w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50">
                        <div className="flex items-center gap-2">
                          {isRunning(t.id) && <span className="breathe h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                          <span className="truncate text-[13px] font-medium text-neutral-800">{t.title}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className={`text-[11px] ${isRunning(t.id) ? "text-emerald-600" : "text-neutral-400"}`}>
                            {isRunning(t.id) ? "正在回答…" : timeAgo(t.created_at)}
                          </span>
                          {t.message_count != null && <span className="num text-[11px] text-neutral-300">{t.message_count} 条</span>}
                        </div>
                      </button>
                      {!isRunning(t.id) && (
                        <button onClick={(e) => { e.stopPropagation(); removeThread(t.id); }} title="删除会话"
                          className="absolute right-2 top-2 rounded-md p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-red-600 group-hover:opacity-100">
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {inputBar}
        </>
      )}

      {/* 对话视图：消息流 */}
      {view === "chat" && (
        <>
          <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2.5">
            <button onClick={backHome}
              className="rounded-md px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
              ← 返回
            </button>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{currentTitle}</span>
            {liveOpen && <span className="breathe h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="正在回答" />}
            {threadId != null && !liveOpen && (
              <button onClick={() => removeThread(threadId)} title="删除此会话"
                className="shrink-0 rounded-md p-1 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-red-600">
                <TrashIcon />
              </button>
            )}
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {shown.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-medium text-neutral-500">向资料提问</p>
                <p className="mt-1 text-xs leading-5 text-neutral-400">回答基于所选范围的资源，并标注来源页码</p>
              </div>
            )}
            {/* 工具调用活动：AI 正在操作资料库（移动/生成笔记等） */}
            {liveOpen && live && live.tools.length > 0 && (
              <div className="space-y-1 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
                {live.tools.map((t, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] leading-4 text-violet-700">
                    <span className="shrink-0">{t.phase === "run" ? "⏳" : t.phase === "done" ? "✅" : "❌"}</span>
                    <span className="min-w-0">
                      {TOOL_LABELS[t.name] ?? t.name}
                      {t.phase === "run" ? "…" : ""}
                      {t.detail ? <span className="text-violet-500">：{t.detail}</span> : null}
                      {t.phase === "error" && !t.detail ? "（失败）" : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {shown.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-xl bg-neutral-900 px-3.5 py-2 text-sm text-white"
                    : "max-w-full text-sm leading-6"
                }>
                  {m.role === "assistant"
                    ? renderAssistant(m.content, m.citations ?? [], openCitation)
                    : m.content}
                </div>
              </div>
            ))}
            {liveOpen && <div className="text-xs text-neutral-400">正在结合资料回答…</div>}
            <div ref={bottomRef} />
          </div>
          {inputBar}
        </>
      )}

      {/* 全部对话 */}
      {view === "all" && (
        <>
          <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2.5">
            <button onClick={() => setView("home")}
              className="rounded-md px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
              ← 返回
            </button>
            <span className="text-xs font-medium text-neutral-600">全部对话</span>
            <span className="num ml-auto text-[11px] text-neutral-300">{threads.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {threads.length === 0 && <p className="px-2 py-4 text-xs text-neutral-300">还没有会话记录</p>}
            {threads.map((t) => (
              <div key={t.id} className="group relative">
                <button onClick={() => openThread(t.id)}
                  className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                    threadId === t.id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>
                  <div className="flex items-center gap-2">
                    {isRunning(t.id) && <span className="breathe h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                    <span className="truncate pr-6 text-[13px] text-neutral-700">{t.title}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-neutral-400">
                    {isRunning(t.id) ? <span className="text-emerald-600">正在回答…</span> : timeAgo(t.created_at)}
                    {t.message_count != null && <span> · {t.message_count} 条</span>}
                  </div>
                </button>
                {!isRunning(t.id) && (
                  <button onClick={(e) => { e.stopPropagation(); removeThread(t.id); }} title="删除会话"
                    className="absolute right-1.5 top-2 rounded-md p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-red-600 group-hover:opacity-100">
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {citation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setCitation(null)}>
          <div className="max-h-[75vh] w-[640px] overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-medium">
                {citation.title}
                {citation.page != null && <span className="ml-2 text-sm text-neutral-500">第 {citation.page} 页</span>}
              </h3>
              <button onClick={() => setCitation(null)} className="text-sm text-neutral-400 hover:text-neutral-900">关闭</button>
            </div>
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              引用片段：{citation.quote}…
            </div>
            <div className="space-y-3 text-sm leading-6 text-neutral-700">
              {citation.chunks.length === 0 && <p className="text-neutral-400">该资源暂无可展示的解析文本。</p>}
              {citation.chunks.map((c, i) => (
                <p key={i} className="whitespace-pre-wrap rounded-lg bg-neutral-50 px-3 py-2">{c.text}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2.5 4h11M6.5 4V2.8c0-.4.3-.8.8-.8h1.4c.5 0 .8.4.8.8V4" strokeLinecap="round" />
      <path d="M5.5 4l.5 9c0 .5.4.8.8.8h2.4c.4 0 .8-.3.8-.8l.5-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 6.8v4.4M9.2 6.8v4.4" strokeLinecap="round" />
    </svg>
  );
}

function renderAssistant(content: string, citations: Citation[], onOpen: (c: Citation) => void) {
  const parts = content.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const n = Number(m[1]);
      const c = citations.find((x) => x.n === n);
      if (c) {
        return (
          <button key={i} onClick={() => onOpen(c)}
            title={`${c.title}${c.page != null ? ` 第 ${c.page} 页` : ""}`}
            className="mx-0.5 inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-1 align-super text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">
            {n}
          </button>
        );
      }
      return <sup key={i} className="text-xs text-neutral-400">[{n}]</sup>;
    }
    return <span key={i} className="whitespace-pre-wrap">{part}</span>;
  });
}

