"use client";

/**
 * 课堂专区（v3，规格 docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md）：
 * 原生 UI——课程列表/搜索/课时/机位播放。不再内嵌 iframe（§7 已整体移除）。
 * 分工（§3）：需要官方会话的请求由本页经反代 3778 发起（Cookie 浏览器托管）；
 * 拿到结果提交 3777 落库；本地列表/课时从 3777 读缓存。
 */
import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import DisclaimerGate, { DISCLAIMER_VERSION } from "@/components/classroom/DisclaimerGate";
import {
  CVS_API_BASE,
  CVS_PROXY_BASE,
  CVS_VIEW_NAMES,
  extractListItems,
  extractVodViews,
} from "@/lib/classroom/types";
import type { ClassroomCourse, ClassroomLesson, CvsCourseItem, CvsVodView } from "@/lib/classroom/types";

type Playing = { lesson: ClassroomLesson; views: CvsVodView[]; viewIdx: number; viaProxy: boolean };

/** 经反代调官方接口（credentials 带 localhost:3778 域 Cookie）。
 *  入参可为绝对 URL（如 CVS_API_BASE 拼出的）或反代相对路径，绝对时不再拼前缀。
 *  GET 失败自动重试一次（上游搜索接口 5-6s 响应且偶发断连，真机实测 2026-11-10）。 */
async function proxyFetch(pathOrUrl: string): Promise<unknown> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : CVS_PROXY_BASE + pathOrUrl;
  let r: Response;
  try {
    r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`反代请求失败 HTTP ${r.status}`);
  } catch (e) {
    await new Promise((res) => setTimeout(res, 1000));
    r = await fetch(url, { credentials: "include" }); // 重试一次
    if (!r.ok) throw new Error(`反代请求失败 HTTP ${r.status}`);
  }
  const ct = r.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? r.json() : r.text();
}

/** 官方直链 → 反代 /__h/ 转发（直链播放失败时的兜底，规格 §3） */
function toProxyUrl(u: string): string {
  const x = new URL(u);
  return `${CVS_PROXY_BASE}/__h/${x.host}${x.pathname}${x.search}`;
}

export default function ClassroomPage() {
  const [agreed, setAgreed] = useState<boolean | null>(null);
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [q, setQ] = useState(""); // 远程搜索词（空=显示已添加课程）
  const [searchResults, setSearchResults] = useState<CvsCourseItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [activeCourse, setActiveCourse] = useState<ClassroomCourse | null>(null);
  const [lessons, setLessons] = useState<ClassroomLesson[]>([]);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [playError, setPlayError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [cookieOpen, setCookieOpen] = useState(false);

  // 同意状态（存版本号：声明更新可重新拦截）
  useEffect(() => {
    setAgreed(localStorage.getItem("ifcope.classroom.agreed") === DISCLAIMER_VERSION);
  }, []);

  // 反代状态
  useEffect(() => {
    fetch("/api/classroom/proxy-info")
      .then((r) => r.json())
      .then((d) => setProxyRunning(Boolean(d.running)))
      .catch(() => setProxyRunning(false));
  }, []);

  // 登录态轮询（Cookie 在 3778 域，跨源带凭据 fetch——CORS 已放行 3777）
  useEffect(() => {
    if (!agreed) return;
    let stop = false;
    const probe = () => {
      fetch(`${CVS_PROXY_BASE}/__whoami`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => !stop && setLoggedIn(Boolean(d.loggedIn)))
        .catch(() => !stop && setLoggedIn(false));
    };
    probe();
    const t = setInterval(probe, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [agreed]);

  const loadCourses = useCallback(async () => {
    try {
      const r = await fetch("/api/classroom/courses");
      const d = (await r.json()) as { courses?: ClassroomCourse[] };
      setCourses(d.courses ?? []);
    } catch {
      /* 本地读失败保持现状 */
    }
  }, []);

  useEffect(() => {
    if (agreed) loadCourses();
  }, [agreed, loadCourses]);

  /** 远程搜索：官方「我的课程」页同一接口+condition（全校课程，搜到自己那门点 + 添加）。
   *  防抖 400ms；失败显式提示，不清已添加列表。 */
  useEffect(() => {
    const kw = q.trim();
    if (!kw) {
      setSearchResults([]);
      setSearchErr(null);
      setSearching(false);
      setSearchPage(1);
      setHasMore(false);
      return;
    }
    let stop = false;
    setSearching(true);
    setSearchErr(null);
    setSearchPage(1);
    const t = setTimeout(() => {
      proxyFetch(
        `${CVS_API_BASE}/teachingclass/list?pageIndex=1&pageSize=100&type=4&allType=1&condition=${encodeURIComponent(kw)}`
      )
        .then((json) => {
          if (stop) return;
          const items = sortNewest(extractListItems(json) as CvsCourseItem[]);
          setSearchResults(items);
          setHasMore(items.length >= 100);
        })
        .catch((e) => {
          if (!stop) setSearchErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!stop) setSearching(false);
        });
    }, 400);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [q]);

  /** 加载更多：搜索翻页追加（同名班跨多年份时首页可能被老班挤满） */
  async function loadMoreSearch() {
    const kw = q.trim();
    const page = searchPage + 1;
    setBusy("加载更多");
    setSearchErr(null);
    try {
      const json = await proxyFetch(
        `${CVS_API_BASE}/teachingclass/list?pageIndex=${page}&pageSize=100&type=4&allType=1&condition=${encodeURIComponent(kw)}`
      );
      const items = extractListItems(json) as CvsCourseItem[];
      setSearchResults((prev) => {
        const seen = new Set(prev.map((it) => String(it.id ?? "")));
        return sortNewest([...prev, ...items.filter((it) => !seen.has(String(it.id ?? "")))]);
      });
      setSearchPage(page);
      setHasMore(items.length >= 100);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** 单门添加：搜索结果一条 → 提交 3777 落库（白名单字段在 store 层）→ 进已添加列表 */
  async function addCourse(item: CvsCourseItem) {
    setBusy("添加课程");
    setError(null);
    setMsg(null);
    try {
      const r = await fetch("/api/classroom/courses/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item] }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `落库失败 HTTP ${r.status}`);
      await loadCourses();
      setMsg({ kind: "ok", text: `已添加：${String(item.subjName || item.teclName || "")}` });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(`添加课程失败：${m}。请确认已登录 CVS 且在校内网/VPN 环境；若持续失败可重新点「登录 CVS」刷新凭据。`);
    } finally {
      setBusy(null);
    }
  }

  /** 进入课程：读本地课时缓存 */
  async function openCourse(course: ClassroomCourse) {
    setActiveCourse(course);
    setPlaying(null);
    setPlayError(false);
    setError(null);
    try {
      const r = await fetch(`/api/classroom/courses/${course.id}/lessons`);
      const d = (await r.json()) as { lessons?: ClassroomLesson[] };
      setLessons(d.lessons ?? []);
    } catch {
      setLessons([]);
    }
  }

  /** 刷新课时：经反代拉 subject_vod_list_new → 整体替换落库（参数见规格 §2） */
  async function refreshLessons() {
    if (!activeCourse) return;
    setBusy("刷新课时");
    setError(null);
    setMsg(null);
    try {
      const qs = new URLSearchParams({
        "page.pageIndex": "1",
        "page.pageSize": "1000",
        teclIds: activeCourse.tecl_id,
        "page.orders[0].asc": "false",
        "page.orders[0].field": "courBeginTime",
        schoolOpenStatusFlag: "false",
      });
      const json = await proxyFetch(`${CVS_API_BASE}/subject_vod_list_new?${qs}`);
      const items = extractListItems(json);
      if (items.length === 0) {
        // 区分「结构正常但无回放」与「结构变化」（真机实测：records 空数组 = 课程未录/未开放）
        const hasRecordsShape =
          typeof json === "object" &&
          json !== null &&
          typeof (json as { data?: { records?: unknown } }).data?.records !== "undefined";
        if (hasRecordsShape) {
          setMsg({ kind: "ok", text: "本课程暂无课时回放（可能课程还没开或未录制）" });
          await fetch(`/api/classroom/courses/${activeCourse.id}/lessons/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [] }),
          });
          setLessons([]);
          return;
        }
        throw new Error("官方课时数据结构变化");
      }
      const r = await fetch(`/api/classroom/courses/${activeCourse.id}/lessons/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `落库失败 HTTP ${r.status}`);
      const r2 = await fetch(`/api/classroom/courses/${activeCourse.id}/lessons`);
      const d2 = (await r2.json()) as { lessons?: ClassroomLesson[] };
      setLessons(d2.lessons ?? []);
      setMsg({ kind: "ok", text: `课时已更新：${d.inserted} 讲` });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(`刷新课时失败：${m}。请确认已登录 CVS 且在校内网/VPN 环境；若持续失败可重新点「登录 CVS」刷新凭据。`);
    } finally {
      setBusy(null);
    }
  }

  /** 点课时：实时取流（直链不落库），空机位显式报错 */
  async function playLesson(lesson: ClassroomLesson) {
    setBusy("取流中");
    setError(null);
    try {
      // 取流接口/参数按参考项目真机验证：course_vod_urls_new?courseId=（course_vod_videoinfos?courId= 会 500）
      const json = await proxyFetch(`${CVS_API_BASE}/course_vod_urls_new?courseId=${lesson.cour_id}`);
      const views = extractVodViews(json);
      if (views.length === 0) throw new Error("未取到可播放机位（转码中或结构变化）");
      setPlaying({ lesson, views, viewIdx: 0, viaProxy: false });
      setPlayError(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(`打开播放失败：${m}。可稍后重试或刷新课时。`);
    } finally {
      setBusy(null);
    }
  }

  const playingSrc =
    playing ? (playing.viaProxy ? toProxyUrl(playing.views[playing.viewIdx].url) : playing.views[playing.viewIdx].url) : "";

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="text-[13px] font-semibold">课堂</div>
            <span className="truncate text-[11px] text-neutral-400">官方录播平台 · 原生浏览</span>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  msg.kind === "err"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}>
                {msg.text}
              </span>
            )}
            {proxyRunning === false && (
              <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                反代未启动
              </span>
            )}
            <button
              onClick={() => window.open(CVS_PROXY_BASE + "/__login", "_blank")}
              title="打开官方登录页（顶层窗口），完成后回到本页"
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
              登录 CVS
            </button>
            <button
              onClick={() => setCookieOpen(true)}
              title="页面内登录无法完成时，手动复制官方页 Cookie 粘贴"
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
              Cookie 兜底
            </button>
            {loggedIn ? (
              <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
                ✓ 已登录
              </span>
            ) : (
              <span className="rounded-md bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500">
                未登录
              </span>
            )}
          </div>
        </div>

        {/* 错误横幅（同步/播放失败显式呈现，不清缓存） */}
        {error && (
          <div className="flex items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-[12px] text-red-700">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600">
              ✕
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* 左栏：搜索 + 课程卡片 */}
          <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200">
            <div className="border-b border-neutral-100 p-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索课程名（如：高等数学）"
                className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {q.trim() ? (
                /* ── 远程搜索结果（全校课程；搜到自己那门点 + 添加） ── */
                searching ? (
                  <div className="mt-6 text-center text-[12px] text-neutral-400">搜索中…（官方接口约 2-6 秒）</div>
                ) : searchErr ? (
                  <div className="mt-4 rounded border border-red-200 bg-red-50 p-2.5 text-[11.5px] leading-5 text-red-700">
                    搜索失败：{searchErr}
                    <br />
                    请确认已登录 CVS 且在校内网/VPN 环境
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="mt-6 text-center text-[12px] text-neutral-400">没有匹配的课程</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {searchResults.map((it) => {
                      const teclId = String(it.id ?? "");
                      const added = courses.some((c) => c.tecl_id === teclId);
                      const name = String(it.subjName || it.teclName || "");
                      return (
                        <div key={teclId} className="flex items-start gap-2 rounded-lg border border-neutral-200 p-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium text-neutral-800" title={name}>
                              {name}
                            </div>
                            <div className="truncate text-[10.5px] text-neutral-500">
                              {String(it.teclName || "")}
                              {it.teclCode ? ` (${String(it.teclCode)})` : ""}
                            </div>
                            <div className="truncate text-[10.5px] text-neutral-400">
                              {itemTeachers(it)}
                              {termFromTeclCode(String(it.teclCode ?? ""))
                                ? ` · ${termFromTeclCode(String(it.teclCode ?? ""))}`
                                : ""}
                            </div>
                          </div>
                          <button
                            onClick={() => addCourse(it)}
                            disabled={added || busy !== null}
                            className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] ${
                              added
                                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                            } disabled:opacity-60`}>
                            {added ? "✓ 已添加" : "+ 添加"}
                          </button>
                        </div>
                      );
                    })}
                    {hasMore && (
                      <button
                        onClick={loadMoreSearch}
                        disabled={busy !== null}
                        className="rounded-lg border border-dashed border-neutral-300 py-2 text-[11.5px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-40">
                        {busy === "加载更多" ? "加载中…" : "加载更多（同名班跨多年份时首页可能被老班占满）"}
                      </button>
                    )}
                  </div>
                )
              ) : courses.length === 0 ? (
                <div className="mt-8 text-center text-[12px] leading-6 text-neutral-400">
                  还没有已添加的课程
                  <br />
                  先「登录 CVS」，再在上方搜索课程名
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openCourse(c)}
                      className={`rounded-lg border p-3 text-left transition ${
                        activeCourse?.id === c.id
                          ? "border-neutral-900 bg-neutral-50"
                          : "border-neutral-200 hover:border-neutral-300"
                      }`}>
                      <div className="flex gap-3">
                        {c.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.cover_url}
                            alt=""
                            className="h-14 w-20 shrink-0 rounded object-cover bg-neutral-100"
                          />
                        ) : (
                          <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-neutral-100 text-[16px]">
                            📚
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-neutral-800" title={c.subj_name}>
                            {c.subj_name}
                          </div>
                          <div className="truncate text-[11px] text-neutral-500" title={`${c.tecl_name}(${c.tecl_code})`}>
                            {c.tecl_name}
                            {c.tecl_code ? ` (${c.tecl_code})` : ""}
                          </div>
                          <div className="truncate text-[11px] text-neutral-400">
                            {safeTeachers(c.teac_names)} · {c.term}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5 text-[10.5px] text-neutral-400">{c.lesson_count} 讲已缓存</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* 右主区 */}
          <section className="flex min-w-0 flex-1 flex-col">
            {playing ? (
              /* ── 播放态 ── */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
                  <div className="min-w-0 truncate text-[13px] font-medium">{playing.lesson.title}</div>
                  <div className="flex items-center gap-1.5">
                    {playing.views.map((v, i) => (
                      <button
                        key={`${v.viewNum}-${i}`}
                        onClick={() => setPlaying({ ...playing, viewIdx: i, viaProxy: false, lesson: playing.lesson })}
                        className={`rounded border px-2 py-1 text-[11px] ${
                          i === playing.viewIdx
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                        }`}>
                        {CVS_VIEW_NAMES[v.viewNum] ?? `机位${v.viewNum}`}
                      </button>
                    ))}
                    <button
                      onClick={() => setPlaying(null)}
                      className="ml-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
                      ← 返回列表
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 bg-black">
                  {playError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-neutral-300">
                      <div>播放失败（直链与代理均已尝试）。可切换机位或稍后重试。</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setPlayError(false);
                            setPlaying({ ...playing, viaProxy: false });
                          }}
                          className="rounded-md border border-neutral-600 px-3 py-1.5 text-[12px] hover:bg-neutral-800">
                          重试
                        </button>
                        <button
                          onClick={() => setPlaying(null)}
                          className="rounded-md border border-neutral-600 px-3 py-1.5 text-[12px] hover:bg-neutral-800">
                          回列表
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* key 强制按课时/机位/通道切换重挂载；直链失败自动切反代代理兜底一次（规格 §3） */
                    <video
                      key={`${playing.lesson.id}:${playing.viewIdx}:${playing.viaProxy ? "p" : "d"}`}
                      src={playingSrc}
                      controls
                      autoPlay
                      className="h-full w-full"
                      onError={() => {
                        if (!playing.viaProxy) setPlaying({ ...playing, viaProxy: true });
                        else setPlayError(true);
                      }}
                    />
                  )}
                </div>
              </div>
            ) : activeCourse ? (
              /* ── 课程态：课时表 ── */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{activeCourse.subj_name}</div>
                    <div className="truncate text-[11px] text-neutral-400">
                      {activeCourse.tecl_name} · {safeTeachers(activeCourse.teac_names)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setActiveCourse(null);
                        setLessons([]);
                      }}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
                      ← 课程
                    </button>
                    <button
                      onClick={refreshLessons}
                      disabled={busy !== null}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-40">
                      {busy === "刷新课时" ? "刷新中…" : "⟳ 刷新课时"}
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {lessons.length === 0 ? (
                    <div className="mt-8 text-center text-[12px] leading-6 text-neutral-400">
                      本课还没有缓存课时
                      <br />
                      点右上「刷新课时」从官方平台拉取（需已登录 + 校内网/VPN）
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {lessons.map((l) => {
                        const playable = l.vod_status === 5;
                        return (
                          <button
                            key={l.id}
                            onClick={() => playable && playLesson(l)}
                            disabled={!playable || busy !== null}
                            className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-left ${
                              playable
                                ? "border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50"
                                : "cursor-not-allowed border-neutral-100 bg-neutral-50 opacity-60"
                            }`}>
                            <div className="min-w-0">
                              <div className={`truncate text-[13px] ${playable ? "text-neutral-800" : "text-neutral-400"}`}>
                                {l.title}
                              </div>
                              <div className="text-[11px] text-neutral-400">{l.begin_time}</div>
                            </div>
                            {!playable ? (
                              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-400">
                                {l.vod_status === -3 ? "转码中" : "不可播"}
                              </span>
                            ) : (
                              <span className="shrink-0 text-[13px] text-neutral-300">▶</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── 空态 ── */
              <div className="flex min-h-0 flex-1 items-center justify-center text-center text-[12.5px] leading-6 text-neutral-400">
                {courses.length === 0 ? (
                  <>
                    从左侧开始：
                    <br />
                    「登录 CVS」→ 搜索课程名 → 点「+ 添加」→ 选课 → 刷课时 → 看回放
                  </>
                ) : (
                  <>← 选择一门课程</>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {cookieOpen && (
        <CookieDialog
          onClose={() => setCookieOpen(false)}
          onSaved={() => {
            setCookieOpen(false);
            setMsg({ kind: "ok", text: "Cookie 已保存，反代将代带它访问 CVS" });
          }}
        />
      )}

      {/* 合规首次声明拦截（硬要求，v2 §7 文本与版本号不变） */}
      {agreed === false && (
        <DisclaimerGate
          onAccept={() => {
            localStorage.setItem("ifcope.classroom.agreed", DISCLAIMER_VERSION);
            setAgreed(true);
          }}
        />
      )}
    </div>
  );
}

/** 按 teclCode 降序：班号前缀就是学期码（202620272B… = 2026-2027学年第2学期），新学期排前 */
function sortNewest(items: CvsCourseItem[]): CvsCourseItem[] {
  return [...items].sort((a, b) =>
    String(b.teclCode ?? "").localeCompare(String(a.teclCode ?? ""))
  );
}

/** 班号前缀解学期：teclCode 格式 `YYYYYYSxxx`（如 202620272B042204001 → 2026-2027学年 第2学期） */
function termFromTeclCode(code: string): string {
  const m = code.match(/^(\d{4})(\d{4})(\d)/);
  return m ? `${m[1]}-${m[2]}学年 第${m[3]}学期` : "";
}

/** 搜索结果条目的师资（teacherList[].userName，同 user 对象结构） */
function itemTeachers(it: CvsCourseItem): string {
  if (!Array.isArray(it.teacherList)) return "";
  return (it.teacherList as unknown[])
    .map((t) => String((t as { userName?: unknown } | null)?.userName ?? ""))
    .filter(Boolean)
    .join("，");
}

/** teac_names 是 JSON 数组字符串，解析失败按原文显示 */
function safeTeachers(json: string): string {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length ? arr.join("，") : "";
  } catch {
    return json;
  }
}

/** 手动 Cookie 兜底：网页登录失败时，从官方页复制 Cookie 粘贴（规格 §8 保底路径，原样保留） */
function CookieDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!value.trim()) {
      setErr("请粘贴 Cookie");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/classroom/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: value.trim() }),
      });
      const d = await r.json();
      if (d.error) setErr(d.error);
      else onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[460px] max-w-full rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">Cookie 兜底</h3>
        <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">
          登录弹窗无法完成时：在浏览器打开 cvs.seu.edu.cn 并登录 → F12 → Network →
          任意请求的 Request Headers 里复制 <b>Cookie</b> 整行值粘贴到下面。保存后由反代代带（只存本机）。
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder="JSESSIONID=…; token=…"
          className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-[11px] outline-none focus:border-neutral-400"
        />
        {err && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-50">
            取消
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

