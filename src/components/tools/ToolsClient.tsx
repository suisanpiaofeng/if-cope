"use client";

/**
 * 工具库客户端主体（学习 it-tools 的目录 + 搜索 + 收藏 + 最近 + 深链）。
 * - 左栏：搜索框 + 收藏/最近 + 可折叠分类（含计数）
 * - 右侧：选中工具的头部信息 + 懒加载的工具组件
 * - URL 深链：/tools?tool=<id>，刷新/分享直达；工具切换即卸载旧组件（内存纪律）
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import Sidebar from "@/components/Sidebar";
import { TOOLS, groupByCategory, matchTool, type ToolDef } from "@/lib/tools/registry";

const KEY_FAV = "ifcope.tools.favorites";
const KEY_RECENT = "ifcope.tools.recent";
const RECENT_MAX = 8;

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function ToolsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeId, setActiveId] = useState<string>(() => {
    const t = searchParams.get("tool");
    return t && TOOLS.some((x) => x.id === t) ? t : TOOLS[0].id;
  });
  const [query, setQuery] = useState("");
  const [fav, setFav] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // 挂载后读取 localStorage（避免 SSR/hydration 不一致）
  useEffect(() => {
    setFav(readList(KEY_FAV).filter((id) => TOOLS.some((t) => t.id === id)));
    setRecent(readList(KEY_RECENT).filter((id) => TOOLS.some((t) => t.id === id)));
  }, []);

  // 记录最近使用
  useEffect(() => {
    setRecent((prev) => {
      const next = [activeId, ...prev.filter((x) => x !== activeId)].slice(0, RECENT_MAX);
      try { localStorage.setItem(KEY_RECENT, JSON.stringify(next)); } catch { /* 忽略配额错误 */ }
      return next;
    });
  }, [activeId]);

  // 深链同步：切换工具时把 ?tool=<id> 写回地址栏（首屏工具不带参数，保持 URL 干净）
  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString());
    if (activeId === TOOLS[0].id) p.delete("tool");
    else p.set("tool", activeId);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pathname]);

  const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const searching = query.trim().length > 0;

  const searchHits = useMemo(
    () => (searching ? TOOLS.filter((t) => matchTool(t, query)) : []),
    [query, searching]
  );

  const favTools = fav.map((id) => TOOLS.find((t) => t.id === id)!).filter(Boolean);
  const recentTools = recent.map((id) => TOOLS.find((t) => t.id === id)!).filter(Boolean);
  const categorized = useMemo(() => groupByCategory(TOOLS), []);

  function toggleFav(id: string) {
    setFav((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(KEY_FAV, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      {/* 左栏：目录 */}
      <div className="flex w-[248px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold tracking-tight">工具库</span>
            <span className="num text-[11px] text-neutral-400">{TOOLS.length} 个</span>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-400">纯本地运行 · 文件不上传</div>
          <div className="relative mt-2.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索工具…"
              className="w-full rounded-md border border-neutral-200 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-neutral-400"
            />
            <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="4.4" /><path d="M10.3 10.3 14 14" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {searching ? (
            <Section title={`搜索结果 · ${searchHits.length}`}>
              {searchHits.length ? (
                searchHits.map((t) => (
                  <ToolRow key={t.id} tool={t} active={t.id === activeId}
                    onSelect={() => setActiveId(t.id)} faved={fav.includes(t.id)}
                    onToggleFav={() => toggleFav(t.id)} />
                ))
              ) : (
                <div className="px-4 py-3 text-xs text-neutral-400">没有匹配的工具</div>
              )}
            </Section>
          ) : (
            <>
              {favTools.length > 0 && (
                <Section title="★ 收藏">
                  {favTools.map((t) => (
                    <ToolRow key={t.id} tool={t} active={t.id === activeId}
                      onSelect={() => setActiveId(t.id)} faved onToggleFav={() => toggleFav(t.id)} />
                  ))}
                </Section>
              )}
              {recentTools.length > 0 && (
                <Section title="最近使用">
                  {recentTools.map((t) => (
                    <ToolRow key={t.id} tool={t} active={t.id === activeId}
                      onSelect={() => setActiveId(t.id)} faved={fav.includes(t.id)}
                      onToggleFav={() => toggleFav(t.id)} />
                  ))}
                </Section>
              )}
              {categorized.map(([cat, tools]) => {
                const isCollapsed = !!collapsed[cat];
                return (
                  <div key={cat} className="mb-0.5">
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                      className="flex w-full items-center justify-between px-4 pb-1 pt-2.5 text-[10px] uppercase tracking-wider text-neutral-400 hover:text-neutral-600"
                    >
                      <span>{cat}</span>
                      <span className="num flex items-center gap-1">
                        {tools.length}
                        <svg className={`h-2.5 w-2.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                    {!isCollapsed &&
                      tools.map((t) => (
                        <ToolRow key={t.id} tool={t} active={t.id === activeId}
                          onSelect={() => setActiveId(t.id)} faved={fav.includes(t.id)}
                          onToggleFav={() => toggleFav(t.id)} />
                      ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* 右侧：工具区 */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-start justify-between border-b border-neutral-200 px-6 py-3">
          <div>
            <div className="text-[15px] font-semibold">{active.name}</div>
            <div className="mt-0.5 text-[12px] text-neutral-500">{active.desc}</div>
          </div>
          <button
            onClick={() => toggleFav(active.id)}
            title={fav.includes(active.id) ? "取消收藏" : "收藏"}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              fav.includes(active.id)
                ? "border-amber-300 bg-amber-50 text-amber-600"
                : "border-neutral-300 text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            {fav.includes(active.id) ? "★ 已收藏" : "☆ 收藏"}
          </button>
        </div>
        <div className="flex-1 px-6 py-5">
          <ToolHost tool={active} />
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-0.5">
      <div className="px-4 pb-1 pt-2 text-[10px] uppercase tracking-wider text-neutral-400">{title}</div>
      {children}
    </div>
  );
}

function ToolRow({ tool, active, onSelect, faved, onToggleFav }: {
  tool: ToolDef; active: boolean; onSelect: () => void; faved: boolean; onToggleFav: () => void;
}) {
  return (
    <div
      className={`group relative flex items-stretch border-l-2 ${
        active ? "border-neutral-900 bg-neutral-100" : "border-transparent"
      }`}
    >
      <button
        onClick={onSelect}
        className={`min-w-0 flex-1 truncate px-4 py-1.5 text-left text-[13px] transition-colors ${
          active ? "font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        {tool.name}
      </button>
      <button
        onClick={onToggleFav}
        title={faved ? "取消收藏" : "收藏"}
        className={`shrink-0 px-2 text-[13px] transition-opacity ${
          faved ? "text-amber-500" : "text-neutral-300 opacity-0 hover:text-amber-500 group-hover:opacity-100"
        }`}
      >
        ★
      </button>
    </div>
  );
}

/** 选中工具的懒加载宿主：切换即卸载旧组件、加载新组件 */
function ToolHost({ tool }: { tool: ToolDef }) {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setComp(null);
    setErr("");
    tool
      .load()
      .then((m) => { if (!cancelled) setComp(() => m.default); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [tool]);

  if (err) {
    return (
      <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        工具加载失败：{err}
      </div>
    );
  }
  if (!Comp) {
    return <div className="py-8 text-center text-xs text-neutral-400">加载中…</div>;
  }
  return <Comp />;
}
