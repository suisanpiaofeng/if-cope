"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/types";
import type { Artifact } from "./FilesPanel";
import { DND_MIME, readDnd } from "@/lib/dnd";
import { NOTE_KINDS } from "@/lib/noteKinds";
import { Markdown } from "./Markdown";
import { mergeTool, type LiveTool } from "@/lib/agent/timeline";
import { lineDiff, formatDiff } from "@/lib/agent/diff";
import ErrorBanner from "./ErrorBanner";
import type { TodoItem } from "@/lib/agent/todo";

type Thread = { id: number; title: string; created_at: number; message_count?: number };
type Message = { id?: number; role: "user" | "assistant"; content: string; reasoning?: string; citations?: Citation[]; live?: boolean };
type Citation = { n: number; sourceId: number; title: string; page: number | null; quote: string };
type PanelView = "home" | "chat" | "all";

/** 工具调用活动（AI 正在操作应用时的实时展示；合并逻辑在 @/lib/agent/timeline） */
const TOOL_LABELS: Record<string, string> = {
  list_library: "查看资料库",
  read_source: "读取资料全文",
  move_source: "移动资料",
  move_artifact: "移动产物",
  create_category: "新建类目",
  generate_summary: "生成复习笔记",
  web_search: "联网搜索",
  todo_write: "更新任务清单",
  load_skill: "加载技能",
  list_files: "浏览文件",
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "修改文件",
  search_code: "搜索代码",
  run_command: "执行命令",
  create_skill: "创建技能",
  install_skill: "安装技能",
};

/** 待确认的写/危险操作卡（harness P0 §4.2） */
type ConfirmCard = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  risk: "readonly" | "reversible" | "destructive" | "deny";
  status: "pending" | "approved" | "rejected";
};

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 3600_000) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)} 小时前`;
  return `${Math.round(d / 86400_000)} 天前`;
}

function mapMsgs(data: { messages?: { id?: number; role: string; content: string; reasoning?: string | null; citations: string | null }[] }): Message[] {
  return (data.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as Message["role"],
    content: m.content,
    reasoning: m.reasoning ?? undefined,
    citations: m.citations ? (JSON.parse(m.citations) as Citation[]) : undefined,
  }));
}

/** 最右对话栏：主界面（最近 3 条）↔ 对话视图 ↔ 全部对话；回答进行中回退不中断 */
export default function ChatPanel({
  sources, artifacts, selected, selectedArts, onSelectionReset, onToggleSource, onToggleArtifact, onGenerateNote, generatingNote, onOrganize, organizing, organizeMsg, onOpenSolve, onOpenSourceById,
}: {
  sources: Source[];
  /** 产物（知识地图/笔记等）：勾选/拖入同样作为问答依据 */
  artifacts: Artifact[];
  /** 已勾选的资源（来自文件栏复选框） */
  selected: Set<number>;
  /** 已勾选的产物 */
  selectedArts: Set<number>;
  /** 发送后重置全部选中 */
  onSelectionReset: () => void;
  /** 勾选/取消勾选一个资源（拖入对话框 = 同步勾选，左侧同步显示） */
  onToggleSource?: (id: number) => void;
  /** 勾选/取消勾选一个产物（知识地图等同样可作为依据） */
  onToggleArtifact?: (id: number) => void;
  /** 便签：基于当前上下文生成结构化产物（导图/流程图/闪卡…） */
  onGenerateNote?: (kind: string) => void;
  /** 正在生成的便签类型（null = 空闲） */
  generatingNote?: string | null;
  /** 快捷功能：自动整理资源（AI 归类） */
  onOrganize?: () => void;
  organizing?: boolean;
  /** 整理结果回执（短暂展示） */
  organizeMsg?: string | null;
  /** 打开解题答疑画布 */
  onOpenSolve?: () => void;
  /** 引用溯源（P3-3 §4.4）：打开源文件并高亮定位 */
  onOpenSourceById?: (id: number, quote?: string) => void;
}) {
  const ready = sources.filter((s) => s.status === "ready");
  // 拖入对话框的视觉反馈（拖入 = 同步勾选，左侧资源栏同步显示；无独立的 dropped 集合）
  const [dropOver, setDropOver] = useState(false);
  // 实际参与检索的资源：勾选集（拖入即进勾选）；空 → 全部资源
  const hasFilter = selected.size > 0;
  const context = hasFilter ? ready.filter((s) => selected.has(s.id)) : ready;
  const totalChunks = context.reduce((n, s) => n + s.chunk_count, 0);
  const [view, setView] = useState<PanelView>("home");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 正在运行的任务：即使回到主界面/打开别的会话，流式仍在后台继续
  const [runThread, setRunThread] = useState<number | null>(null);
  const [live, setLive] = useState<{ question: string; content: string; reasoning: string; citations: Citation[]; tools: LiveTool[]; confirms: ConfirmCard[]; run?: { round: number; maxRounds: number; intent?: string } } | null>(null);
  // 任务清单独立于 live（自审修复：回答结束后面板不随 live 清空，人机共写可持续）
  const [plan, setPlan] = useState<TodoItem[]>([]);
  // 会话分支/回滚（P1 §7.2）
  const [confirmTrunc, setConfirmTrunc] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [citation, setCitation] = useState<{ sourceId: number; title: string; page: number | null; chunks: { page: number | null; text: string }[]; quote: string } | null>(null);
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
      // 载入该会话的任务清单（人机共写：打开会话即可继续编辑）
      const pt = await fetch(`/api/agent/todos?threadId=${id}`).then((r) => r.json()).catch(() => null);
      if (threadIdRef.current === id) setPlan(pt?.todos ?? []);
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

  // 会话分支：复制到指定消息为止的历史，开新会话（P1 §7.2）
  async function branchFrom(beforeMessageId: number) {
    if (!threadId) return;
    const r = await fetch("/api/chat/branch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, beforeMessageId }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.newThreadId) {
      loadThreads();
      await openThread(d.newThreadId);
      setView("chat");
    } else {
      setError(d?.error ?? "分支失败，请重试");
    }
  }

  // 会话回滚：删除指定消息之后的全部消息（不可逆，红色二次确认）
  async function truncateFrom(fromMessageId: number) {
    if (!threadId) return;
    if (confirmTrunc !== fromMessageId) {
      setConfirmTrunc(fromMessageId);
      setTimeout(() => setConfirmTrunc((c) => (c === fromMessageId ? null : c)), 3000);
      return;
    }
    setConfirmTrunc(null);
    const r = await fetch("/api/chat/truncate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, fromMessageId }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.ok) await openThread(threadId);
    else setError(d?.error ?? "回滚失败，请重试");
  }

  async function ask() {
    const question = input.trim();
    if (!question || streaming) return;
    if (context.length === 0 && selectedArts.size === 0) { setError(hasFilter ? "所选文件中还没有可检索的资源" : "还没有可检索的资源，先上传并解析成功"); return; }
    setError(null);
    setInput("");
    setView("chat");
    setStreaming(true);
    setRunThread(threadId); // 新对话时为 null，与 threadId 一致
    setLive({ question, content: "", reasoning: "", citations: [], tools: [], confirms: [] });
    if (!threadId) setPlan([]); // 新会话从空清单开始；已有会话保留当前清单
    // 开启一段工作：选中状态回归初始（拖入已并入勾选，一并清空）
    onSelectionReset();
    let tid = threadId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, sourceIds: context.map((s) => s.id), artifactIds: [...selectedArts], question }),
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
          if (evt.confirm) setLive((l) => (l ? { ...l, confirms: [...l.confirms, { ...evt.confirm, status: "pending" }] } : l));
          if (evt.plan) setPlan(evt.plan.todos);
          if (evt.run) setLive((l) => (l ? { ...l, run: evt.run } : l));
          if (evt.reasoning) setLive((l) => (l ? { ...l, reasoning: l.reasoning + evt.reasoning } : l));
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

  // 引用跳转：useCallback 稳定引用（Markdown memo 性能）；从历史/实时引用里找编号对应项
  const openCitation = useCallback((n: number) => {
    const c =
      messages.flatMap((m) => m.citations ?? []).find((x) => x.n === n) ??
      live?.citations.find((x) => x.n === n);
    if (!c) return;
    void fetch(`/api/lookup?sourceId=${c.sourceId}&page=${c.page}`)
      .then((r) => r.json())
      .then((data) => setCitation({ sourceId: c.sourceId, title: data.title, page: c.page, chunks: data.chunks, quote: c.quote }))
      .catch(() => {});
  }, [messages, live]);

  // 拖入对话框 = 同步勾选（左侧资源栏同步打勾，输入框上方胶囊可移除）；产物同样支持
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropOver(false);
    const payload = readDnd(e.dataTransfer);
    if (!payload) return;
    if (payload.kind === "source" && onToggleSource) {
      for (const id of payload.ids) {
        if (!selected.has(id)) onToggleSource(id);
      }
    } else if (payload.kind === "artifact" && onToggleArtifact) {
      for (const id of payload.ids) {
        if (!selectedArts.has(id)) onToggleArtifact(id);
      }
    }
  }

  // 对话框上方的上下文胶囊：勾选集（ready 才能参与检索）+ 产物胶囊
  const contextPills = ready.filter((s) => selected.has(s.id));
  const artifactPills = artifacts.filter((a) => selectedArts.has(a.id));

  // 渲染用消息：进行中的会话追加“用户提问 + 实时回答”覆盖层
  // （服务端在流开始前就存了用户消息，重进会话时已带它，这里按内容去重）
  const shown = (() => {
    if (!liveOpen || !live) return messages;
    const last = messages[messages.length - 1];
    const hasUser = last && last.role === "user" && last.content === live.question;
    const base = hasUser ? messages : [...messages, { role: "user" as const, content: live.question }];
    return [...base, { role: "assistant" as const, content: live.content, reasoning: live.reasoning, citations: live.citations, live: true }];
  })();

  const isRunning = (id: number) => streaming && runThread === id;
  const currentTitle = threads.find((t) => t.id === threadId)?.title ?? "新对话";

  // 底部输入条（主界面 / 对话视图共用）
  const quickBar = (
    <div className="flex flex-wrap items-center gap-1 px-4 pb-1 pt-2">
      <span className="num shrink-0 text-[10px] text-neutral-400">快捷功能</span>
      {NOTE_KINDS.map((k) => (
        <button
          key={k.kind}
          onClick={() => onGenerateNote?.(k.kind)}
          disabled={!!generatingNote || !!organizing || context.length === 0}
          title={`基于当前上下文生成${k.label}`}
          className={`border px-2 py-0.5 text-[11px] transition-colors ${
            generatingNote === k.kind
              ? "border-violet-500 bg-violet-50 text-violet-700"
              : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
          } disabled:opacity-40`}
        >
          <span className="mr-0.5">{k.icon}</span>
          {k.label}
        </button>
      ))}
      <button
        onClick={() => onOpenSolve?.()}
        disabled={!!generatingNote || !!organizing}
        title="解题 / 提问，生成带引用出处的非线性解答图"
        className="border border-violet-300 px-2 py-0.5 text-[11px] text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-40"
      >
        <span className="mr-0.5">🔍</span>
        解题答疑
      </button>
      <span className="mx-0.5 h-3 w-px bg-neutral-200" />
      <button
        onClick={() => onOrganize?.()}
        disabled={!!organizing || !!generatingNote || context.length === 0}
        title="用 AI 自动把当前资源归入类目"
        className="border border-violet-200 px-2 py-0.5 text-[11px] text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-40"
      >
        <span className="mr-0.5">🗂</span>
        {organizing ? "整理中…" : "整理资源"}
      </button>
      {generatingNote && <span className="num self-center text-[10px] text-violet-500">生成中…</span>}
    </div>
  );

  const inputBar = (
    <>
      {error && (
        <div className="mx-4 mb-2"><ErrorBanner message={error} /></div>
      )}
      {quickBar}
      {organizeMsg && (
        <div className="mx-4 mb-1 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-700">
          {organizeMsg}
        </div>
      )}
      <div className="border-t border-neutral-100 px-4 py-3"
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)}
        onDrop={handleDrop}
      >
        {/* 上下文胶囊：勾选/拖入的文件逐个显示（× 移除；空 = 全部资源）；右侧模型徽章 */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {hasFilter || artifactPills.length > 0 ? (
              <>
                {contextPills.map((s) => (
                  <span key={s.id}
                    className="flex max-w-[160px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                    <span className="truncate" title={s.title}>{s.title}</span>
                    <button onClick={() => onToggleSource?.(s.id)} className="shrink-0 text-violet-400 hover:text-violet-700" title="移出（同步取消左侧勾选）">×</button>
                  </span>
                ))}
                {artifactPills.map((a) => (
                  <span key={`a${a.id}`}
                    className="flex max-w-[160px] items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    <span className="truncate" title={a.title}>{a.type === "qa-map" ? "🗺 " : "📝 "}{a.title}</span>
                    <button onClick={() => onToggleArtifact?.(a.id)} className="shrink-0 text-emerald-400 hover:text-emerald-700" title="移出（同步取消左侧勾选）">×</button>
                  </span>
                ))}
                {hasFilter ? (
                  <span className="num shrink-0 text-[10px] text-neutral-400">依据 {context.length} 份 · {totalChunks} 块</span>
                ) : (
                  <span className="shrink-0 text-[10px] text-neutral-400">未选资源 → 检索全部 + 上述产物</span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-neutral-400">未选资源 → 检索全部（拖文件进来 = 指定依据）</span>
            )}
          </div>
          <span className="mono shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-400">{model ?? "未配置"}</span>
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
                          <ThreadTitle id={t.id} title={t.title} onRenamed={loadThreads} />
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
            {/* 任务面板：人机共写清单（状态/文本可改，写回 agent_todos，下轮模型能感知） */}
            {plan.length > 0 && (
              <TodoPanel
                todos={plan}
                threadId={threadId}
                onChange={setPlan}
              />
            )}
            {/* 确认卡片：写/危险操作需学生放行（destructive 二次确认） */}
            {liveOpen && live && live.confirms.length > 0 && (
              <div className="space-y-1.5">
                {live.confirms.map((c) => (
                  <ConfirmBox key={c.callId} card={c} onDone={(status) =>
                    setLive((l) => (l ? { ...l, confirms: l.confirms.map((x) => (x.callId === c.callId ? { ...x, status } : x)) } : l))
                  } />
                ))}
              </div>
            )}
            {/* 工具调用活动：AI 正在操作资料库（移动/生成笔记等），按轮次+意图展示 */}
            {liveOpen && live && live.tools.length > 0 && (
              <div className="space-y-1 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
                {live.tools.map((t, i) => (
                  <div key={t.callId ?? i} className="flex items-start gap-1.5 text-[11px] leading-4 text-violet-700">
                    <span className="shrink-0">{t.phase === "run" ? "⏳" : t.phase === "done" ? "✅" : "❌"}</span>
                    <span className="min-w-0">
                      {t.round >= 0 ? <span className="text-violet-400">[第{t.round + 1}轮] </span> : null}
                      {TOOL_LABELS[t.name] ?? t.name}
                      {t.phase === "run" ? "…" : ""}
                      {t.intent ? <span className="text-violet-500"> — {t.intent}</span> : null}
                      {t.detail ? <span className="text-violet-500">：{t.detail}</span> : null}
                      {t.phase === "error" && !t.detail ? "（失败）" : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {shown.map((m, i) => (
              <div key={m.id ?? `live-${i}`} className={m.role === "user" ? "group/msg flex justify-end" : "group/msg relative"}>
                {m.id && !m.live ? (
                  <div className={`mb-1 flex gap-1.5 text-[10px] text-neutral-300 opacity-0 transition-opacity group-hover/msg:opacity-100 ${m.role === "user" ? "justify-end" : ""}`}>
                    <button onClick={() => branchFrom(m.id!)} title="复制到此为止的历史，开新会话" className="hover:text-neutral-600">⑂ 从此分支</button>
                    <button
                      onClick={() => truncateFrom(m.id!)}
                      title="删除这条之后的消息（不可逆）"
                      className={confirmTrunc === m.id ? "text-red-500" : "hover:text-red-500"}
                    >
                      {confirmTrunc === m.id ? "⚠ 确认回滚？" : "⟲ 回滚到此处"}
                    </button>
                  </div>
                ) : null}
                <div className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-xl bg-neutral-900 px-3.5 py-2 text-sm text-white"
                    : "max-w-full text-sm leading-6"
                }>
                  {m.role === "assistant" ? (
                    <>
                      {(m.reasoning ?? "") !== "" && (
                        <details open={m.live} className="group/re mb-1.5">
                          <summary className="cursor-pointer select-none text-[11px] text-neutral-400 hover:text-neutral-600">
                            {m.live ? "💭 思考中…" : "💭 思考过程"}（点击展开/收起）
                          </summary>
                          <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2 text-[12px] leading-5 whitespace-pre-wrap text-neutral-500">
                            {m.reasoning}
                          </div>
                        </details>
                      )}
                      <Markdown
                        text={m.content}
                        citations={m.citations?.map((c) => ({ n: c.n, title: c.title, page: c.page }))}
                        onCitation={m.live ? undefined : openCitation}
                        className="max-w-none text-sm leading-6 text-neutral-800"
                      />
                    </>
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === "assistant" && <CopyBtn text={m.content} />}
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
                    <ThreadTitle id={t.id} title={t.title} onRenamed={loadThreads} className="pr-6 text-neutral-700" />
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onOpenSourceById?.(citation.sourceId, citation.quote);
                    setCitation(null);
                  }}
                  className="rounded-lg border border-neutral-200 px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  📍 打开源文件
                </button>
                <button onClick={() => setCitation(null)} className="text-sm text-neutral-400 hover:text-neutral-900">关闭</button>
              </div>
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


/** 回答气泡的悬停复制按钮：贴右上角，悬停显现；复制原文（Markdown 源码，非渲染文本） */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      title="复制回答（Markdown）"
      className="absolute -top-1 right-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 shadow-sm transition-opacity hover:text-neutral-900 group-hover/msg:opacity-100"
    >
      {copied ? "✓" : "⧉ 复制"}
    </button>
  );
}

/** 任务面板（计划 Task 6）：人机共写清单——状态点击循环三态、文本双击编辑、✕ 删除；
 *  任何改动乐观更新本地 plan 并 PUT /api/agent/todos 写回（下轮模型从表读到的就是改后的）；
 *  失败回滚并提示。收起态 `☑ n/m` 徽标，点击展开。 */
function TodoPanel({
  todos,
  threadId,
  onChange,
}: {
  todos: TodoItem[];
  threadId: number | null;
  onChange: (todos: TodoItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const doneCount = todos.filter((t) => t.status === "completed").length;

  async function commit(next: TodoItem[]) {
    const prev = todos;
    onChange(next); // 乐观更新
    setErr(null);
    if (!threadId) return;
    try {
      const r = await fetch("/api/agent/todos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, todos: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      onChange(prev); // 回滚
      setErr("保存失败，已还原");
    }
  }

  function cycle(id: number) {
    const order: TodoItem["status"][] = ["pending", "in_progress", "completed"];
    commit(
      todos.map((t) =>
        t.id === id ? { ...t, status: order[(order.indexOf(t.status) + 1) % 3] } : t
      )
    );
  }

  function saveEdit() {
    const text = draft.trim();
    if (editingId != null && text) {
      commit(todos.map((t) => (t.id === editingId ? { ...t, text } : t)));
    }
    setEditingId(null);
  }

  const ICONS: Record<TodoItem["status"], string> = { pending: "⬜", in_progress: "🔵", completed: "✅" };

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[11px] text-emerald-700">
        <span>☑ {doneCount}/{todos.length}</span>
        <span className="text-emerald-500">{open ? "收起任务清单" : "任务清单（点击展开/编辑）"}</span>
      </button>
      {err && <div className="mt-1 text-[10px] text-red-500">{err}</div>}
      {open && (
        <ul className="mt-2 space-y-1">
          {todos.map((t) => (
            <li key={t.id} className="flex items-center gap-1.5 text-[11px] leading-4">
              <button onClick={() => cycle(t.id)} title="点击切换状态" className="shrink-0">
                {ICONS[t.status]}
              </button>
              {editingId === t.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-emerald-200 px-1 py-0.5 text-[11px]"
                />
              ) : (
                <span
                  onDoubleClick={() => {
                    setEditingId(t.id);
                    setDraft(t.text);
                  }}
                  title="双击编辑"
                  className={`min-w-0 flex-1 cursor-text truncate ${
                    t.status === "completed" ? "text-neutral-400 line-through" : "text-neutral-700"
                  }`}>
                  {t.text}
                </span>
              )}
              <button
                onClick={() => commit(todos.filter((x) => x.id !== t.id))}
                title="删除"
                className="shrink-0 text-neutral-300 hover:text-red-400">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 确认卡片（harness P0 §4.2）：reversible 一次点击；destructive 需二次点击「确认执行」；
 *  服务端 60s 无响应自动拒绝（后端兜底，前端到点仅展示）。 */
function ConfirmBox({ card, onDone }: { card: ConfirmCard; onDone: (status: "approved" | "rejected") => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const danger = card.risk === "destructive";

  async function decide(approve: boolean) {
    if (busy || card.status !== "pending") return;
    if (danger && approve && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    await fetch("/api/agent/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: card.callId, approve }),
    }).catch(() => null);
    onDone(approve ? "approved" : "rejected");
  }

  const argText = Object.entries(card.args ?? {})
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join("，");

  // diff 预览（P1 §7.1）：edit_file 显示行 diff；write_file 显示新增内容摘要
  let diffText = "";
  if (card.name === "edit_file" && typeof card.args?.old === "string" && typeof card.args?.new === "string") {
    diffText = formatDiff(lineDiff(card.args.old, card.args.new), 40);
  } else if (card.name === "write_file" && typeof card.args?.content === "string") {
    const lines = String(card.args.content).split(/\r?\n/);
    diffText = lines.slice(0, 10).map((l) => `+ ${l}`).join("\n") + (lines.length > 10 ? `\n……（共 ${lines.length} 行）` : "");
  }

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${
      danger ? "border-red-200 bg-red-50/70" : "border-amber-200 bg-amber-50/70"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-medium ${danger ? "text-red-700" : "text-amber-700"}`}>
            {danger ? "⚠️ 不可逆操作，需确认" : "写操作确认"}：{TOOL_LABELS[card.name] ?? card.name}
          </div>
          <div className="mt-0.5 truncate text-neutral-500" title={argText}>{argText || "（无参数）"}</div>
          {diffText && (
            <pre className="mono mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/80 p-2 text-[10px] leading-4 text-neutral-700">
              {diffText}
            </pre>
          )}
        </div>
        {card.status === "pending" ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className={`rounded-lg px-2.5 py-1 font-medium text-white disabled:opacity-50 ${
                danger ? (armed ? "bg-red-600 hover:bg-red-700" : "bg-red-400 hover:bg-red-500") : "bg-neutral-900 hover:bg-neutral-700"
              }`}>
              {danger ? (armed ? "确认执行" : "允许") : "允许"}
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="rounded-lg border border-neutral-200 px-2.5 py-1 text-neutral-600 hover:bg-white disabled:opacity-50">
              拒绝
            </button>
          </div>
        ) : (
          <span className={`shrink-0 ${card.status === "approved" ? "text-emerald-600" : "text-neutral-400"}`}>
            {card.status === "approved" ? "✓ 已允许" : "✕ 已拒绝"}
          </span>
        )}
      </div>
    </div>
  );
}

/** 会话标题：双击重命名（harness P0 §5） */
function ThreadTitle({ id, title, onRenamed, className = "text-neutral-800" }: { id: number; title: string; onRenamed: () => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const v = draft.trim();
    setEditing(false);
    if (!v || v === title || busy) return;
    setBusy(true);
    await fetch("/api/chat", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: id, title: v }),
    }).catch(() => null);
    setBusy(false);
    onRenamed();
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded border border-neutral-300 px-1.5 py-0.5 text-[13px] outline-none"
      />
    );
  }
  return (
    <span
      title="双击重命名"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(title);
        setEditing(true);
      }}
      className={`min-w-0 flex-1 cursor-text truncate text-[13px] font-medium ${className}`}
    >
      {title}
    </span>
  );
}
