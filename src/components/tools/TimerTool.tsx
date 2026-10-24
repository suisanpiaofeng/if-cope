"use client";

/** 计时器 / 秒表：倒计时 + 正计时，含提醒与 lap 记录 */
import { useEffect, useRef, useState } from "react";
import { Actions, Btn, NumInput, PrimaryBtn } from "./_ui";

function fmt(ms: number): string {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  const base = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? base : `${base}.${String(cs).padStart(2, "0")}`;
}

export default function TimerTool() {
  const [mode, setMode] = useState<"countdown" | "stopwatch">("countdown");
  // 倒计时
  const [initH, setInitH] = useState(0);
  const [initM, setInitM] = useState(5);
  const [initS, setInitS] = useState(0);
  const [remain, setRemain] = useState(0); // ms
  // 正计时
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const baseRef = useRef(0); // 运行起始时刻的剩余/已用
  const rafRef = useRef(0);

  const totalMs = (initH * 3600 + initM * 60 + initS) * 1000;

  useEffect(() => {
    if (!running) return;
    baseRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      if (mode === "countdown") {
        const left = baseRef.current === 0 ? 0 : remain;
        setRemain((r) => {
          const next = r - (now - baseRef.current);
          baseRef.current = now;
          if (next <= 0) { setRunning(false); setDone(true); beep(); return 0; }
          return next;
        });
        void left;
      } else {
        setElapsed((e) => {
          const add = now - baseRef.current;
          baseRef.current = now;
          return e + add;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode]);

  function start() {
    setDone(false);
    if (mode === "countdown" && remain <= 0) setRemain(totalMs);
    setRunning(true);
  }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false); setDone(false); setLaps([]);
    if (mode === "countdown") setRemain(totalMs); else setElapsed(0);
  }
  function switchMode(m: typeof mode) {
    setMode(m); setRunning(false); setDone(false); setLaps([]);
    setRemain(totalMs); setElapsed(0);
  }

  const display = mode === "countdown" ? remain : elapsed;
  const progress = mode === "countdown" && totalMs > 0 ? remain / totalMs : 0;

  return (
    <div className="mx-auto max-w-[480px] text-center">
      <Actions>
        <Btn onClick={() => switchMode("countdown")}>{mode === "countdown" ? "✓ 倒计时" : "倒计时"}</Btn>
        <Btn onClick={() => switchMode("stopwatch")}>{mode === "stopwatch" ? "✓ 秒表" : "秒表"}</Btn>
      </Actions>

      {mode === "countdown" && !running && remain <= 0 && !done && (
        <div className="mb-4 flex items-center justify-center gap-2 text-sm">
          <NumInput value={initH} onChange={setInitH} min={0} max={23} className="w-20" /><span>时</span>
          <NumInput value={initM} onChange={setInitM} min={0} max={59} className="w-20" /><span>分</span>
          <NumInput value={initS} onChange={setInitS} min={0} max={59} className="w-20" /><span>秒</span>
        </div>
      )}

      <div className={`relative mx-auto my-6 flex h-56 w-56 items-center justify-center rounded-full border-4 ${done ? "border-red-400 bg-red-50" : "border-neutral-200"}`}>
        {mode === "countdown" && (
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="#e5e5e5" strokeWidth="4" />
            <circle cx="50" cy="50" r="46" fill="none" stroke={done ? "#f87171" : "#171717"} strokeWidth="4"
              strokeDasharray={2 * Math.PI * 46} strokeDashoffset={2 * Math.PI * 46 * (1 - progress)} />
          </svg>
        )}
        <div className={`num font-mono text-3xl font-semibold ${done ? "text-red-600" : "text-neutral-900"}`}>
          {fmt(display)}
        </div>
      </div>

      <div className="flex justify-center gap-2">
        {!running
          ? <PrimaryBtn onClick={start}>{done ? "重新开始" : mode === "countdown" && remain <= 0 ? "开始" : "继续"}</PrimaryBtn>
          : <Btn onClick={pause}>暂停</Btn>}
        <Btn onClick={reset}>重置</Btn>
        {mode === "stopwatch" && running && <Btn onClick={() => setLaps((l) => [elapsed, ...l])}>计次</Btn>}
      </div>

      {mode === "stopwatch" && laps.length > 0 && (
        <div className="mx-auto mt-5 max-w-[280px] border border-neutral-200 text-left">
          {laps.map((l, i) => (
            <div key={i} className="flex justify-between border-b border-neutral-100 px-3 py-1.5 text-xs last:border-b-0">
              <span className="text-neutral-400">第 {laps.length - i} 次</span>
              <span className="num font-mono">{fmt(l)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch { /* 无声环境忽略 */ }
}
