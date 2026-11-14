"use client";

/**
 * 课堂专区（v3，规格 docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md）：
 * 原生 UI——三栏布局：左栏已添加课程（搜索为弹窗添加）、中栏课时窄栏（选中课程后出现）、右栏机位播放。
 * 不再内嵌 iframe（§7 已整体移除）。
 * 分工（§3）：需要官方会话的请求由本页经反代 3778 发起（Cookie 浏览器托管）；
 * 拿到结果提交 3777 落库；本地列表/课时从 3777 读缓存。
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

/** 上游/反代 HTTP 错误（带状态码供错误分类） */
class ProxyError extends Error {
  status: number;
  constructor(status: number) {
    super(`反代请求失败 HTTP ${status}`);
    this.status = status;
  }
}

/** 错误分类（2026-11-10 真机教训：会话过期既可能 401 也可能 500（过期 Cookie 糊弄过网关后应用 NPE），
 *  不能仅凭状态码断言原因——报错后需实测登录态再归类，见 refineError）：
 *  401/403=登录过期；5xx=平台故障或会话过期；502/504/网络=连不通（反代 fail() 写死 502）。 */
type ErrInfo = { kind: "auth" | "upstream" | "network" | "generic"; text: string };
function classifyError(e: unknown): ErrInfo {
  const msg = e instanceof Error ? e.message : String(e);
  const status = e instanceof ProxyError ? e.status : undefined;
  if (status === 401 || status === 403) {
    return { kind: "auth", text: `登录已过期（HTTP ${status}）：请点「登录 CVS」刷新凭据后重试。` };
  }
  if (status !== undefined && status >= 500 && status !== 502 && status !== 504) {
    return { kind: "upstream", text: `CVS 平台内部出错（HTTP ${status}），请稍后重试；若持续出现可尝试重新登录。` };
  }
  if (status === 502 || status === 504 || /超时|无法访问|fetch failed|ECONN|network/i.test(msg)) {
    return { kind: "network", text: "无法连接 CVS：请确认校园网/VPN 连通后重试。" };
  }
  return { kind: "generic", text: msg };
}

/** 上游报错后实测登录态再归类（2026-11-10 真机教训：会话过期既可能 401 也可能 500，
 *  且「登录 CVS」弹窗自述的“已登录”可能滞后于真实会话——以 __whoami 实测为准）。
 *  auth/upstream 类错误才需复核；探测失败保持原分类。 */
async function refineError(err: ErrInfo): Promise<ErrInfo> {
  if (err.kind !== "auth" && err.kind !== "upstream") return err;
  try {
    const r = await fetch(`${CVS_PROXY_BASE}/__whoami`, { credentials: "include" });
    const d = (await r.json()) as { loggedIn?: boolean };
    if (!d.loggedIn) {
      return {
        kind: "auth",
        text: "登录会话已过期：请点「登录 CVS」重新登录后再试。（过期会让官方接口报 500/401）",
      };
    }
  } catch {
    /* 探测失败保持原分类 */
  }
  return err;
}

/** 经反代调官方接口（credentials 带 localhost:3778 域 Cookie）。
 *  入参可为绝对 URL（如 CVS_API_BASE 拼出的）或反代相对路径，绝对时不再拼前缀。
 *  GET 失败自动重试一次（上游搜索接口 5-6s 响应且偶发断连，真机实测 2026-11-10）。 */
async function proxyFetch(pathOrUrl: string): Promise<unknown> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : CVS_PROXY_BASE + pathOrUrl;
  let r: Response;
  try {
    r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new ProxyError(r.status);
  } catch {
    await new Promise((res) => setTimeout(res, 1000));
    r = await fetch(url, { credentials: "include" }); // 重试一次
    if (!r.ok) throw new ProxyError(r.status);
  }
  const ct = r.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? r.json() : r.text();
}

/** 官方直链 → 反代 /__h/ 转发（直链播放失败时的兜底，规格 §3）。
 *  防御：URL 非法/相对路径时原样交 video，让 onError 走错误面板（不能在渲染路径 throw） */
function toProxyUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${CVS_PROXY_BASE}/__h/${x.host}${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

export default function ClassroomPage() {
  const [agreed, setAgreed] = useState<boolean | null>(null);
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [activeCourse, setActiveCourse] = useState<ClassroomCourse | null>(null);
  const [lessons, setLessons] = useState<ClassroomLesson[]>([]);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [playError, setPlayError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeAtRef = useRef(0); // 换机位/代理兑底重挂载后恢复播放位置（2026-11-10 用户反馈：换机位从头播很痛苦）
  const wasPausedRef = useRef(false); // 换机位时保持暂停态（暂停着看细节切机位不该突然开播）
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrInfo | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [deleting, setDeleting] = useState<ClassroomCourse | null>(null);

  // 需要登录时直接跳出新页登录（2026-11-12 用户反馈：学校登录要手机验证码，浏览器 Basic 弹窗永远登不上——
  // 反代已剥 www-authenticate 根治弹窗；这里自动打开登录页，被浏览器拦截时以「登录 CVS」按钮兑底）
  const autoLoginRef = useRef(false);
  useEffect(() => {
    if (loggedIn === true) {
      autoLoginRef.current = false; // 重新登录成功后，下次过期再自动跳
      return;
    }
    if ((loggedIn === false || error?.kind === "auth") && !autoLoginRef.current) {
      autoLoginRef.current = true;
      window.open(CVS_PROXY_BASE + "/__login", "_blank");
    }
  }, [loggedIn, error]);

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

  /** 单门添加：搜索结果一条 → 提交 3777 落库（白名单字段在 store 层）→ 进已添加列表。
   *  返回错误信息（null=成功），由搜索弹窗内联呈现。 */
  async function addCourse(item: CvsCourseItem): Promise<string | null> {
    try {
      const r = await fetch("/api/classroom/courses/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item] }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `落库失败 HTTP ${r.status}`);
      await loadCourses();
      return null;
    } catch (e) {
      return `添加课程失败：${(await refineError(classifyError(e))).text}`;
    }
  }

  /** 删除已添加课程：连同课时缓存一并删除（后端 ON DELETE CASCADE） */
  async function removeCourse(c: ClassroomCourse) {
    setBusy("删除课程");
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/classroom/courses/${c.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `删除失败 HTTP ${r.status}`);
      if (activeCourse?.id === c.id) {
        setActiveCourse(null);
        setLessons([]);
      }
      if (playing && playing.lesson.course_id === c.id) {
        setPlaying(null);
        setPlayError(false);
      }
      await loadCourses();
      setMsg({ kind: "ok", text: `已删除：${c.subj_name}` });
    } catch (e) {
      const { kind, text } = classifyError(e);
      setError({ kind, text: `删除课程失败：${text}` });
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  /** 进入课程：读本地课时缓存（课时出现在中栏窄栏） */
  async function openCourse(course: ClassroomCourse) {
    setActiveCourse(course);
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
      const { kind, text } = await refineError(classifyError(e));
      setError({ kind, text: `刷新课时失败：${text}` });
    } finally {
      setBusy(null);
    }
  }

  /** 点课时：实时取流（直链不落库），空机位显式报错；播放器常驻右栏 */
  async function playLesson(lesson: ClassroomLesson) {
    setBusy("取流中");
    setError(null);
    try {
      // 取流接口/参数按参考项目真机验证：course_vod_urls_new?courseId=（course_vod_videoinfos?courId= 会 500）
      const json = await proxyFetch(`${CVS_API_BASE}/course_vod_urls_new?courseId=${lesson.cour_id}`);
      const views = extractVodViews(json);
      if (views.length === 0) throw new Error("未取到可播放机位（转码中或结构变化）");
      resumeAtRef.current = 0; // 新课时从头播
      wasPausedRef.current = false;
      setPlaying({ lesson, views, viewIdx: 0, viaProxy: false });
      setPlayError(false);
    } catch (e) {
      const { kind, text } = await refineError(classifyError(e));
      setError({ kind, text: `打开播放失败：${text}` });
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
          <div
            className={`flex items-start justify-between gap-3 border-b px-5 py-2 text-[12px] ${
              error.kind === "auth" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"
            }`}>
            <span>{error.text}</span>
            <div className="flex shrink-0 items-center gap-2">
              {error.kind === "auth" && (
                <button
                  onClick={() => window.open(CVS_PROXY_BASE + "/__login", "_blank")}
                  className="rounded border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100">
                  登录 CVS
                </button>
              )}
              <button
                onClick={() => setError(null)}
                className={error.kind === "auth" ? "text-amber-400 hover:text-amber-600" : "text-red-400 hover:text-red-600"}>
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 登录态预警（2026-11-10 教训：会话过期后接口报 500/401 容易误判为平台故障，主动亮条免得用户乱试） */}
        {loggedIn === false && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-800">
            <span>CVS 未登录或会话已过期：已尝试在新页打开登录页（手机验证码登录）；若被浏览器拦截，请点右侧按钮。搜索/刷新/播放都需要有效会话。</span>
            <button
              onClick={() => window.open(CVS_PROXY_BASE + "/__login", "_blank")}
              className="shrink-0 rounded border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100">
              登录 CVS
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* 左栏：已添加课程（搜索为弹窗） */}
          <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200">
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2.5">
              <span className="text-[12px] font-semibold text-neutral-700">我的课程</span>
              <button
                onClick={() => setSearchOpen(true)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
                ＋ 添加
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {courses.length === 0 ? (
                <div className="mt-8 text-center text-[12px] leading-6 text-neutral-400">
                  还没有已添加的课程
                  <br />
                  先「登录 CVS」，再点右上「＋ 添加」搜索
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {courses.map((c) => (
                    <div
                      key={c.id}
                      className={`group relative rounded-lg border p-2.5 transition ${
                        activeCourse?.id === c.id
                          ? "border-neutral-900 bg-neutral-50"
                          : "border-neutral-200 hover:border-neutral-300"
                      }`}>
                      <button onClick={() => openCourse(c)} className="flex w-full gap-2 text-left">
                        {c.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.cover_url}
                            alt=""
                            className="h-11 w-16 shrink-0 rounded object-cover bg-neutral-100"
                          />
                        ) : (
                          <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded bg-neutral-100 text-[14px]">
                            📚
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate pr-5 text-[12.5px] font-medium text-neutral-800" title={c.subj_name}>
                            {c.subj_name}
                          </div>
                          <div className="truncate text-[10.5px] text-neutral-500" title={`${c.tecl_name}(${c.tecl_code})`}>
                            {c.tecl_name}
                            {c.tecl_code ? ` (${c.tecl_code})` : ""}
                          </div>
                          <div className="truncate text-[10.5px] text-neutral-400">
                            {safeTeachers(c.teac_names)} · {c.term}
                          </div>
                          <div className="mt-0.5 text-[10px] text-neutral-400">{c.lesson_count} 讲已缓存</div>
                        </div>
                      </button>
                      {/* 删除课程（含课时缓存，二次确认） */}
                      <button
                        onClick={() => setDeleting(c)}
                        title="删除课程（含课时缓存）"
                        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-[11px] text-neutral-300 opacity-60 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* 中栏：课时窄栏（选中课程后才出现） */}
          {activeCourse && (
            <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/50">
              <div className="border-b border-neutral-100 px-3 py-2">
                <div className="truncate text-[12px] font-semibold text-neutral-800" title={activeCourse.subj_name}>
                  {activeCourse.subj_name}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-neutral-400">{lessons.length} 讲</span>
                  <button
                    onClick={refreshLessons}
                    disabled={busy !== null}
                    className="shrink-0 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-40">
                    {busy === "刷新课时" ? "刷新中…" : "⟳ 刷新"}
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {lessons.length === 0 ? (
                  <div className="mt-6 px-2 text-center text-[11px] leading-5 text-neutral-400">
                    本课还没有缓存课时
                    <br />
                    点上方「⟳ 刷新」拉取
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {lessons.map((l) => {
                      const playable = l.vod_status === 5;
                      const isPlaying = playing?.lesson.id === l.id;
                      return (
                        <button
                          key={l.id}
                          onClick={() => playable && playLesson(l)}
                          disabled={!playable || busy !== null}
                          title={l.title}
                          className={`rounded-md px-2.5 py-1.5 text-left transition ${
                            isPlaying
                              ? "bg-neutral-900 text-white"
                              : playable
                                ? "hover:bg-neutral-100"
                                : "cursor-not-allowed opacity-50"
                          }`}>
                          <div className={`truncate text-[11.5px] ${isPlaying ? "text-white" : "text-neutral-700"}`}>
                            {l.title}
                          </div>
                          <div className={`text-[10px] ${isPlaying ? "text-neutral-300" : "text-neutral-400"}`}>
                            {!playable
                              ? l.vod_status === -3
                                ? "转码中"
                                : "不可播"
                              : l.begin_time.slice(11, 16)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* 右栏：播放器 / 占位 */}
          <section className="flex min-w-0 flex-1 flex-col">
            {playing ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2">
                  <div className="min-w-0 truncate text-[13px] font-medium">{playing.lesson.title}</div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {playing.views.map((v, i) => (
                      <button
                        key={`${v.viewNum}-${i}`}
                        onClick={() => {
                          // 记住当前进度/暂停态，换机位后接着看（否则重挂载回到片头）
                          if (videoRef.current) {
                            resumeAtRef.current = videoRef.current.currentTime;
                            wasPausedRef.current = videoRef.current.paused;
                          }
                          setPlaying({ ...playing, viewIdx: i, viaProxy: false, lesson: playing.lesson });
                        }}
                        className={`rounded border px-2 py-1 text-[11px] ${
                          i === playing.viewIdx
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                        }`}>
                        {CVS_VIEW_NAMES[v.viewNum] ?? `机位${v.viewNum}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1 bg-black">
                  {playError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-neutral-300">
                      <div>播放失败（直链与代理均已尝试）。可切换机位或稍后重试。</div>
                      <button
                        onClick={() => {
                          setPlayError(false);
                          setPlaying({ ...playing, viaProxy: false });
                        }}
                        className="rounded-md border border-neutral-600 px-3 py-1.5 text-[12px] hover:bg-neutral-800">
                        重试
                      </button>
                    </div>
                  ) : (
                    /* key 强制按课时/机位/通道切换重挂载；直链失败自动切反代代理兜底一次（规格 §3） */
                    <video
                      key={`${playing.lesson.id}:${playing.viewIdx}:${playing.viaProxy ? "p" : "d"}`}
                      ref={videoRef}
                      src={playingSrc}
                      controls
                      autoPlay
                      className="h-full w-full"
                      onTimeUpdate={() => {
                        // 持续记进度：直链失败切代理兑底时也能续上
                        if (videoRef.current) resumeAtRef.current = videoRef.current.currentTime;
                      }}
                      onLoadedMetadata={() => {
                        // 重挂载（换机位/兑底/重试）后回到原位置；新课时 resumeAt=0 即从头播
                        const v = videoRef.current;
                        if (!v || resumeAtRef.current <= 0) return;
                        const at =
                          Number.isFinite(v.duration) && v.duration > 0
                            ? Math.min(resumeAtRef.current, v.duration - 0.5)
                            : resumeAtRef.current;
                        v.currentTime = Math.max(0, at);
                        if (wasPausedRef.current) v.pause();
                      }}
                      onError={() => {
                        if (!playing.viaProxy) setPlaying({ ...playing, viaProxy: true });
                        else setPlayError(true);
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              /* ── 占位 ── */
              <div className="flex min-h-0 flex-1 items-center justify-center text-center text-[12.5px] leading-6 text-neutral-400">
                {activeCourse ? (
                  <>← 在课时列表中选择一节课开始播放</>
                ) : courses.length === 0 ? (
                  <>
                    从左侧开始：
                    <br />
                    「登录 CVS」→「＋ 添加」搜索课程 → 选课 → 刷课时 → 看回放
                  </>
                ) : (
                  <>← 选择一门课程</>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {searchOpen && (
        <SearchCourseDialog
          addedIds={new Set(courses.map((c) => c.tecl_id))}
          busy={busy}
          onAdd={addCourse}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDeleteDialog
          course={deleting}
          busy={busy === "删除课程"}
          onCancel={() => setDeleting(null)}
          onConfirm={() => removeCourse(deleting)}
        />
      )}

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

/** 当前学年学期码前缀：8 月（含）后为「当年-次年」，否则「去年-当年」（如 2026-11 → 20262027） */
function currentAcYearPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 8 ? y : y - 1;
  return `${start}${start + 1}`;
}

/** 当前学年判断：班号前缀 == 当前学年学期码（如 2026-11 → 20262027） */
function isCurrentYear(it: CvsCourseItem): boolean {
  return String(it.teclCode ?? "").startsWith(currentAcYearPrefix());
}

/** 搜索结果排序：当前学年排最前，其余按学期码降序（新学期在前） */
function sortCurrentFirst(items: CvsCourseItem[]): CvsCourseItem[] {
  return [...items].sort(
    (a, b) =>
      (isCurrentYear(a) ? 0 : 1) - (isCurrentYear(b) ? 0 : 1) ||
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

/** 搜索添加课程弹窗：官方「我的课程」页同一接口+condition（全校课程）。
 *  防抖 400ms；排序当前学年优先；点「＋ 添加」入库（错误内联显示）。 */
function SearchCourseDialog({
  addedIds,
  busy,
  onAdd,
  onClose,
}: {
  addedIds: Set<string>;
  busy: string | null;
  onAdd: (item: CvsCourseItem) => Promise<string | null>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CvsCourseItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  /** 远程搜索（防抖 400ms；失败显式提示）。
   *  上游固定按老课在前返回（排序参数无效，2026-11-10 四种写法实测均被忽略）——新学年课程
   *  被挤到后面页。因此首页没有当前学年课程时自动补拉后续页（最多共 5 页）直到找到，
   *  免去用户手动「加载更多」翻到底再翻回来的痛苦。 */
  useEffect(() => {
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      setErr(null);
      setSearching(false);
      setSearchPage(1);
      setHasMore(false);
      return;
    }
    let stop = false;
    setSearching(true);
    setErr(null);
    setSearchPage(1);
    const fetchPage = (page: number) =>
      proxyFetch(
        `${CVS_API_BASE}/teachingclass/list?pageIndex=${page}&pageSize=100&type=4&allType=1&condition=${encodeURIComponent(kw)}`
      );
    const t = setTimeout(async () => {
      try {
        const json = await fetchPage(1);
        if (stop) return;
        const totalPage = Number((json as { data?: { totalPage?: number } }).data?.totalPage ?? 1);
        let all = extractListItems(json) as CvsCourseItem[];
        let page = 1;
        setResults(sortCurrentFirst(all));
        setSearchPage(page);
        setHasMore(page < totalPage);
        // 自动补拉：没有当前学年课程且还有后续页时，逐页拉到找到为止（上限 5 页防死循环）
        while (!stop && page < totalPage && page < 5 && !all.some(isCurrentYear)) {
          page += 1;
          const more = extractListItems(await fetchPage(page)) as CvsCourseItem[];
          if (stop) return;
          const seen = new Set(all.map((it) => String(it.id ?? "")));
          all = [...all, ...more.filter((it) => !seen.has(String(it.id ?? "")))];
          setResults(sortCurrentFirst(all));
          setSearchPage(page);
          setHasMore(page < totalPage);
        }
      } catch (e) {
        if (!stop) setErr(classifyError(e).text);
      } finally {
        if (!stop) setSearching(false);
      }
    }, 400);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [q]);

  /** 加载更多：搜索翻页追加（同名班跨多年份时首页可能被老班挤满） */
  async function loadMore() {
    const kw = q.trim();
    const page = searchPage + 1;
    setLoadingMore(true);
    setErr(null);
    try {
      const json = await proxyFetch(
        `${CVS_API_BASE}/teachingclass/list?pageIndex=${page}&pageSize=100&type=4&allType=1&condition=${encodeURIComponent(kw)}`
      );
      const totalPage = Number((json as { data?: { totalPage?: number } }).data?.totalPage ?? 1);
      const items = extractListItems(json) as CvsCourseItem[];
      setResults((prev) => {
        const seen = new Set(prev.map((it) => String(it.id ?? "")));
        return sortCurrentFirst([...prev, ...items.filter((it) => !seen.has(String(it.id ?? "")))]);
      });
      setSearchPage(page);
      setHasMore(page < totalPage);
    } catch (e) {
      setErr(classifyError(e).text);
    } finally {
      setLoadingMore(false);
    }
  }

  async function add(item: CvsCourseItem) {
    const teclId = String(item.id ?? "");
    setAddingId(teclId);
    setErr(null);
    const e = await onAdd(item);
    if (e) setErr(e);
    setAddingId(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30" onClick={onClose}>
      <div
        className="mt-20 flex max-h-[70vh] w-[640px] max-w-full flex-col rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">搜索添加课程</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          搜索全校课程（当前学年的排最前），找到自己那门点「＋ 添加」。需已登录 CVS 且在校内网/VPN 环境。
        </p>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索课程名（如：高等数学）"
          className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12.5px] outline-none focus:border-neutral-400"
        />
        {err && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-[11px] leading-5 text-red-700">{err}</div>
        )}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {!q.trim() ? (
            <div className="py-10 text-center text-[12px] text-neutral-400">输入课程名开始搜索（官方接口约 2-6 秒）</div>
          ) : searching ? (
            <div className="py-10 text-center text-[12px] text-neutral-400">
              搜索中…（官方接口约 2-6 秒；正在定位当前学年课程，老课多时会自动多拉几页）
            </div>
          ) : results.length > 0 ? (
            <div className="flex flex-col gap-2">
              {results.map((it) => {
                const teclId = String(it.id ?? "");
                const added = addedIds.has(teclId);
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
                      onClick={() => add(it)}
                      disabled={added || addingId !== null || busy !== null}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] ${
                        added
                          ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                          : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      } disabled:opacity-60`}>
                      {added ? "✓ 已添加" : addingId === teclId ? "添加中…" : "＋ 添加"}
                    </button>
                  </div>
                );
              })}
              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={addingId !== null || loadingMore}
                  className="rounded-lg border border-dashed border-neutral-300 py-2 text-[11.5px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-40">
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              )}
            </div>
          ) : (
            <div className="py-10 text-center text-[12px] text-neutral-400">没有匹配的课程</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 删除确认框：课程 + 课时缓存一并删除 */
function ConfirmDeleteDialog({
  course,
  busy,
  onCancel,
  onConfirm,
}: {
  course: ClassroomCourse;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-[380px] max-w-full rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">删除课程</h3>
        <p className="mt-2 text-[12px] leading-6 text-neutral-600">
          删除《{course.subj_name}》并清空其 {course.lesson_count} 讲课时缓存？
          <br />
          <span className="text-[11px] text-neutral-400">之后可重新搜索添加。</span>
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
            {busy ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
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
