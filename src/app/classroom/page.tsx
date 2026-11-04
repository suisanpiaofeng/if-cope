"use client";

/**
 * 课堂专区：纯内嵌浏览器（整块 iframe → 反代 3778 → 官方录播平台）。
 * 旧的课程树/课时/笔记/期末手册功能已整体移除，等待重新构思（2026-10-30）。
 * 保留：合规声明拦截、登录态同源探测（iframe 上报）、重载保持当前页、主页回平台首页、Cookie 兜底。
 */
import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import DisclaimerGate, { DISCLAIMER_VERSION } from "@/components/classroom/DisclaimerGate";

const PROXY = "http://localhost:3778";

export default function ClassroomPage() {
  const [agreed, setAgreed] = useState<boolean | null>(null);
  // 登录态：iframe（3778 同源）注入脚本探测后上报，比跨源 fetch 可靠
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [reloadKey, setReloadKey] = useState(0); // 重载内嵌 iframe
  const [manualSrc, setManualSrc] = useState<string | null>(null); // 重载时保持当前页（不回首页）
  const [cookieOpen, setCookieOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const navUrlRef = useRef(`${PROXY}/jy-application-resourcemanage-ui/`); // iframe 当前真实地址（注入脚本上报）
  const frameAuthRef = useRef(0); // 最近一次 iframe 同源探测登录态的时间戳
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /** 向 iframe 发导航指令（注入脚本代执行；跨端口只能 postMessage） */
  function frameNav(cmd: "home") {
    iframeRef.current?.contentWindow?.postMessage({ source: "ifcope-host", cmd }, PROXY);
  }

  // 同意状态（存版本号：声明更新可重新拦截）
  useEffect(() => {
    setAgreed(localStorage.getItem("ifcope.classroom.agreed") === DISCLAIMER_VERSION);
  }, []);

  // 代理状态
  useEffect(() => {
    fetch("/api/classroom/proxy-info")
      .then((r) => r.json())
      .then((d) => setProxyRunning(Boolean(d.running)))
      .catch(() => setProxyRunning(false));
  }, []);

  // 登录态轮询（兜底；iframe 内同源探测结果到达时以其为准，15s 内不覆盖）
  useEffect(() => {
    if (!agreed || !proxyRunning) return;
    let stop = false;
    const probe = () => {
      if (Date.now() - frameAuthRef.current < 15000) return;
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

  // 接收 iframe（3778 反代注入脚本）上报：登录态 + 当前导航（重载保持位置用）
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== PROXY) return;
      const d = e.data as
        | { source?: string; type?: string; url?: string; title?: string; loggedIn?: boolean }
        | null;
      if (!d || d.source !== "ifcope-frame") return;
      if (d.type === "auth") {
        frameAuthRef.current = Date.now();
        setLoggedIn(Boolean(d.loggedIn));
        return;
      }
      if (d.type === "nav" && d.url) navUrlRef.current = d.url;
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="text-[13px] font-semibold">课堂</div>
            <span className="truncate text-[11px] text-neutral-400">官方录播平台 · 应用内嵌浏览</span>
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
              onClick={() => {
                setManualSrc(navUrlRef.current); // 保持当前页，不回首页
                setReloadKey((k) => k + 1);
              }}
              title="重新加载当前内嵌页面（保持在你现在看的这一页）"
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
              ↻ 重载
            </button>
            <button
              onClick={() => frameNav("home")}
              title="内嵌页面回平台首页"
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
              ⌂ 主页
            </button>
            {loggedIn ? (
              <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
                ✓ 已登录
              </span>
            ) : (
              <span className="rounded-md bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500">
                未登录 · 请在右侧页面内登录
              </span>
            )}
            <button
              onClick={() => setCookieOpen(true)}
              title="页面内登录无法完成时，手动复制官方页 Cookie 粘贴"
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50">
              Cookie 兜底
            </button>
          </div>
        </div>

        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={manualSrc ?? PROXY + "/jy-application-resourcemanage-ui/"}
          title="录播平台"
          className="min-h-0 flex-1 border-0"
        />
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

      {/* 合规首次声明拦截（硬要求：内嵌官方教学资源必须先声明） */}
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
