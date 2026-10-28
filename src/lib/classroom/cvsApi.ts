/**
 * CVS 官方接口常量与解析（规格 §2.2：全部集中在此，真机联调只改这里）。
 * 注意：fetch 封装由客户端页面调用（Cookie 在浏览器侧），服务端 route 不 import fetch 系函数。
 */

export const CVS_ORIGIN = "https://cvs.seu.edu.cn";
export const PROXY_ORIGIN = "http://localhost:3778";

/**
 * 官方接口路径（真机联调：F12 打开官方课程页，看真实请求的 path/query 改这里）。
 * 占位路径会在 fetch 时返回 404 → fetchLessons 返回明确的「未联调」错误。
 */
export const API = {
  /** 课时目录：按课程 id 拉回放列表 */
  lessons: (teclId: string) => `${CVS_ORIGIN}/api/lesson/list?teclId=${encodeURIComponent(teclId)}`,
  /** AI 字幕：按课时取字幕 segments（课后 12h 内平台生成） */
  subtitles: (lessonCvsId: string) =>
    `${CVS_ORIGIN}/api/subtitle/get?lessonId=${encodeURIComponent(lessonCvsId)}`,
};

/** 从课程链接解析明文 teclId；加密分享链接/无关链接返回 null（规格 §4：一期只支持明文） */
export function parseTeclId(url: string): string | null {
  const m = url.match(/[?&]teclId=([^&#]+)/);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return null;
}

/** 官方课时目录条目（fetch 封装的返回契约，供 POST /api/classroom/lessons 落库） */
export type FetchedLesson = {
  cvsLessonId: string;
  title: string;
  seq: number;
  replayUrl: string;
  vodStatus: number | null;
  durationSec: number | null;
};

/**
 * 拉课时目录（**浏览器侧**经反代调用，credentials: include 让浏览器带上 localhost 会话 Cookie）。
 * 官方接口未联调（404/结构不符）→ 明确错误，不死等。
 */
export async function fetchLessons(
  teclId: string
): Promise<{ ok: boolean; lessons?: FetchedLesson[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch(API.lessons(teclId), { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 404
          ? "课时接口未联调（占位路径），先用「手动添加课时」"
          : `课时接口错误 HTTP ${res.status}（未登录？确认已点「登录 CVS」）`,
    };
  }
  try {
    const data = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(data.data) ? data.data : null;
    if (!rows) return { ok: false, error: "课时接口返回结构不符（真机联调：核对 API.lessons 路径）" };
    const lessons: FetchedLesson[] = rows.map((r, i) => ({
      cvsLessonId: String(r.lessonId ?? r.id ?? `row-${i}`),
      title: String(r.lessonName ?? r.title ?? `第 ${i + 1} 讲`),
      seq: Number(r.seq ?? i + 1),
      replayUrl: String(r.playUrl ?? r.replayUrl ?? ""),
      vodStatus: r.vodStatus != null ? Number(r.vodStatus) : null,
      durationSec: r.duration != null ? Number(r.duration) : null,
    }));
    return { ok: true, lessons };
  } catch {
    return { ok: false, error: "课时接口返回非 JSON（真机联调：核对 API.lessons 路径）" };
  }
}

/**
 * 拉 AI 字幕（**浏览器侧**经反代调用）。返回带时间戳 segments 或明确错误。
 */
export async function fetchSubtitles(
  lessonCvsId: string
): Promise<{ ok: boolean; segments?: { start: number; end: number; text: string }[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch(API.subtitles(lessonCvsId), { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 404
          ? "字幕接口未联调（占位路径）；平台 AI 字幕课后 12h 内生成，可先用「粘贴课堂文本」"
          : `字幕接口错误 HTTP ${res.status}`,
    };
  }
  try {
    const data = (await res.json()) as { data?: Array<{ start?: number; end?: number; text?: string }> };
    const rows = Array.isArray(data.data) ? data.data : null;
    if (!rows) return { ok: false, error: "字幕接口返回结构不符（真机联调：核对 API.subtitles 路径）" };
    const segments = rows.map((r) => ({
      start: Number(r.start ?? 0),
      end: Number(r.end ?? 0),
      text: String(r.text ?? ""),
    }));
    return { ok: true, segments };
  } catch {
    return { ok: false, error: "字幕接口返回非 JSON（真机联调：核对 API.subtitles 路径）" };
  }
}
