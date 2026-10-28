"use client";

/**
 * 课堂专区 v2（规格 docs/课堂专区-架构规格-v2-20261028.md）。
 * 视频优先三栏：课程树 / 课时列表 / 右栏主区（▶视频 / ✎笔记 双标签）。
 * 登录走反代网页（零 Playwright）：window.open 官方登录页，Cookie 由浏览器托管（localhost 域）。
 */
import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import DisclaimerGate, { DISCLAIMER_VERSION } from "@/components/classroom/DisclaimerGate";
import type { ClassroomCourse, ClassroomLesson } from "@/lib/classroom/types";

const PROXY = "http://localhost:3778";

export default function ClassroomPage() {
  const [agreed, setAgreed] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [lessons, setLessons] = useState<ClassroomLesson[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null);
  // 登录态
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  // 登记
  const [regOpen, setRegOpen] = useState(false);
  const [regBusy, setRegBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 同意状态（存版本号：声明更新可重新拦截）
  useEffect(() => {
    setAgreed(localStorage.getItem("ifcope.classroom.agreed") === DISCLAIMER_VERSION);
  }, []);

  // 代理状态 + 登录态轮询（5s；服务端看不到浏览器 Cookie，由前端探测反代 __whoami）
  useEffect(() => {
    fetch("/api/classroom/proxy-info")
      .then((r) => r.json())
      .then((d) => setProxyRunning(Boolean(d.running)))
      .catch(() => setProxyRunning(false));
  }, []);

  useEffect(() => {
    if (!agreed || !proxyRunning) return;
    let stop = false;
    const probe = () => {
      fetch(`${PROXY}/__whoami`, { credentials: "include" })
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
  }, [agreed, proxyRunning]);

  const loadCourses = useCallback(async () => {
    const r = await fetch("/api/classroom/courses");
    const d = await r.json();
    setCourses(d.courses ?? []);
    if (!activeCourseId && d.courses?.length) setActiveCourseId(d.courses[0].id);
  }, [activeCourseId]);

  useEffect(() => {
    if (agreed) void loadCourses();
  }, [agreed, loadCourses]);

  useEffect(() => {
    if (activeCourseId == null) {
      setLessons([]);
      return;
    }
    fetch(`/api/classroom/lessons?courseId=${activeCourseId}`)
      .then((r) => r.json())
      .then((d) => setLessons(d.lessons ?? []))
      .catch(() => setLessons([]));
  }, [activeCourseId]);

  const activeCourse = courses.find((c) => c.id === activeCourseId) ?? null;
  const activeLesson = lessons.find((l) => l.id === activeLessonId) ?? null;

  /** 弹顶层窗口走官方 CAS 网页登录（Cookie 落 localhost，浏览器托管） */
  function doLogin() {
    if (loginBusy) return;
    setLoginBusy(true);
    window.open(`${PROXY}/__login`, "cvs-login", "width=520,height=720");
    // 登录窗是独立窗口，无法直接读结果——靠轮询 __whoami 更新徽标
    setTimeout(() => setLoginBusy(false), 2000);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      <div className="flex min-w-0 flex-1">
        {/* 左：课程树 */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-neutral-200">
          <div className="border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold tracking-tight">课堂</div>
              <button
                onClick={() => setRegOpen(true)}
                className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-700">
                ＋ 登记
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">看回放 · 逐课笔记 · 期末复习手册</div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {courses.length === 0 ? (
              <p className="rounded border border-dashed border-neutral-200 px-3 py-4 text-center text-[11px] text-neutral-300">
                暂无课程 · 点「＋登记」粘贴课程链接
              </p>
            ) : (
              courses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveCourseId(c.id);
                    setActiveLessonId(null);
                  }}
                  className={`block w-full rounded-lg px-2.5 py-2 text-left text-[13px] ${
                    c.id === activeCourseId ? "bg-neutral-100" : "hover:bg-neutral-50"
                  }`}>
                  <div className={`truncate font-medium ${c.id === activeCourseId ? "text-neutral-900" : "text-neutral-600"}`}>
                    {c.name}
                  </div>
                  <div className="num mt-0.5 text-[10px] text-neutral-400">
                    {c.lesson_count > 0 ? `${c.processed_count}/${c.lesson_count} 课时有笔记` : "尚未同步课时"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 中：课时列表（T4 填充） */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-neutral-200">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="truncate text-[13px] font-semibold">{activeCourse?.name ?? "课时"}</div>
          </div>
          {msg && (
            <div
              className={`mx-3 mt-2 border px-2.5 py-1.5 text-[11px] ${
                msg.kind === "err"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}>
              {msg.text}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {!activeCourse ? (
              <p className="rounded border border-dashed border-neutral-200 px-3 py-4 text-center text-[11px] text-neutral-300">
                选择左侧课程
              </p>
            ) : lessons.length === 0 ? (
              <p className="rounded border border-dashed border-neutral-200 px-3 py-4 text-center text-[11px] text-neutral-300">
                尚无课时（T4：同步课时 / 手动添加）
              </p>
            ) : (
              lessons.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLessonId(l.id)}
                  className={`block w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] ${
                    l.id === activeLessonId ? "bg-neutral-100" : "hover:bg-neutral-50"
                  }`}>
                  <div className="truncate text-neutral-700">{l.title}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右：主区（视频/笔记双标签；内容 T4/T5 填充） */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-2.5">
            <div className="truncate text-[13px] font-semibold">
              {activeLesson ? "课时（T4 接视频）" : "课堂"}
            </div>
            <div className="flex items-center gap-2">
              {proxyRunning === false && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  反代未启动
                </span>
              )}
              <button
                onClick={doLogin}
                disabled={proxyRunning === false || loginBusy}
                title="弹出官方登录页完成学校统一认证（Cookie 自动保存在本机浏览器）"
                className={`rounded-md px-2.5 py-1 text-[11px] ${
                  loggedIn
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "bg-neutral-900 text-white hover:bg-neutral-700"
                } disabled:opacity-40`}>
                {loginBusy ? "已弹出窗口…" : loggedIn ? "✓ 已登录" : "登录 CVS"}
              </button>
              <button
                onClick={() => setCookieOpen(true)}
                title="登录窗口无法完成时，手动复制官方页 Cookie 粘贴"
                className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
                Cookie 兜底
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-[420px] text-center">
              <p className="text-sm text-neutral-500">
                {activeLesson ? "内嵌播放（T4）" : "选择课时后这里看回放"}
              </p>
              <p className="mt-1 text-xs text-neutral-400">逐课笔记与期末复习手册（T5-T7）</p>
            </div>
          </div>
        </main>
      </div>

      {/* 登记课程弹窗 */}
      {regOpen && (
        <RegisterDialog
          busy={regBusy}
          onClose={() => setRegOpen(false)}
          onSubmit={async (v) => {
            setRegBusy(true);
            try {
              const r = await fetch("/api/classroom/courses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(v),
              });
              const d = await r.json();
              if (d.error) return d.error;
              await loadCourses();
              if (d.id) setActiveCourseId(d.id);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "登记失败";
            } finally {
              setRegBusy(false);
            }
          }}
        />
      )}

      {/* 手动 Cookie 兜底弹窗 */}
      {cookieOpen && (
        <CookieDialog
          onClose={() => setCookieOpen(false)}
          onSaved={() => {
            setCookieOpen(false);
            setMsg({ kind: "ok", text: "Cookie 已保存，反代将代带它访问 CVS" });
          }}
        />
      )}

      {/* 合规首次声明拦截 */}
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

/** 登记课程弹窗：粘贴官方课程链接（明文 teclId）+ 可选名称/学期 */
function RegisterDialog({ busy, onClose, onSubmit }: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { url: string; name?: string; term?: string }) => Promise<string | null>;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!url.trim()) {
      setErr("请填写课程页链接");
      return;
    }
    const e = await onSubmit({ url: url.trim(), name: name.trim() || undefined, term: term.trim() || undefined });
    if (e) setErr(e);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={busy ? undefined : onClose}>
      <div className="w-[420px] max-w-full rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">登记课程</h3>
        <p className="mt-1 text-[11px] text-neutral-400">
          粘贴课程平台（cvs.seu.edu.cn）的课程页链接；需校园网环境
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 text-[11px] text-neutral-400">课程页链接 *</div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              placeholder="https://cvs.seu.edu.cn/…?teclId=…"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[11px] text-neutral-400">课程名（可选）</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 高等数学A"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] text-neutral-400">学期（可选）</div>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="如 2026秋"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
            </div>
          </div>
        </div>
        {err && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
            {busy ? "登记中…" : "登记"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 手动 Cookie 兜底：网页登录失败时，从官方页复制 Cookie 粘贴（规格 §8 保底路径） */
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
          <button onClick={onClose} className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-50">
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
