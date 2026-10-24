"use client";

/** 时区转换：北京时间 ↔ 世界主要城市，含当前时间与 UTC 偏移 */
import { useEffect, useState } from "react";
import { Select } from "./_ui";

const ZONES: { tz: string; label: string }[] = [
  { tz: "Asia/Shanghai", label: "北京 UTC+8" },
  { tz: "Asia/Tokyo", label: "东京 UTC+9" },
  { tz: "Asia/Seoul", label: "首尔 UTC+9" },
  { tz: "Asia/Singapore", label: "新加坡 UTC+8" },
  { tz: "Asia/Kolkata", label: "新德里 UTC+5:30" },
  { tz: "Europe/London", label: "伦敦 UTC+0/+1" },
  { tz: "Europe/Paris", label: "巴黎 UTC+1/+2" },
  { tz: "Europe/Berlin", label: "柏林 UTC+1/+2" },
  { tz: "Europe/Moscow", label: "莫斯科 UTC+3" },
  { tz: "America/New_York", label: "纽约 UTC-5/-4" },
  { tz: "America/Chicago", label: "芝加哥 UTC-6/-5" },
  { tz: "America/Los_Angeles", label: "洛杉矶 UTC-8/-7" },
  { tz: "Australia/Sydney", label: "悉尼 UTC+10/+11" },
  { tz: "UTC", label: "UTC" },
];

function fmtIn(tz: string, d: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(d);
}

function offsetOf(tz: string, d: Date): string {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return s.replace("GMT", "UTC") || "UTC+0";
}

export default function TimezoneConverter() {
  const [now, setNow] = useState(new Date());
  const [from, setFrom] = useState("Asia/Shanghai");
  const [pick, setPick] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 以「来源时区的墙钟时间」构造绝对时刻
  const baseDate = (() => {
    if (!pick) return now;
    const guess = new Date(pick);
    if (isNaN(guess.getTime())) return now;
    // 用来源时区当前偏移把墙钟时间转 UTC
    const offMs = tzOffsetMs(from, guess);
    return new Date(guess.getTime() - offMs);
  })();

  return (
    <div className="max-w-[640px] space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-500">来源时区</span>
        <Select value={from} onChange={setFrom} options={ZONES.map((z) => ({ value: z.tz, label: z.label }))} />
        <input type="datetime-local" step={1} value={pick} onChange={(e) => setPick(e.target.value)}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400" />
      </div>

      <div className="border border-neutral-200">
        {ZONES.map((z, i) => (
          <div key={z.tz} className={`flex items-center gap-3 px-3 py-2 text-sm ${i ? "border-t border-neutral-100" : ""} ${z.tz === from ? "bg-neutral-50" : ""}`}>
            <span className="w-36 shrink-0 text-xs text-neutral-500">{z.label}</span>
            <span className="num min-w-0 flex-1 font-mono text-neutral-900">{fmtIn(z.tz, baseDate)}</span>
            <span className="num w-24 shrink-0 text-right text-[11px] text-neutral-400">{offsetOf(z.tz, baseDate)}</span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-neutral-400">当前实时（{fmtIn("Asia/Shanghai", now)} 北京）；改上方时间即全局换算。</div>
    </div>
  );
}

function tzOffsetMs(tz: string, at: Date): number {
  // 通过格式化到该时区的墙钟，再解析回 UTC，反推偏移
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}
