/**
 * 课堂专区 v3 类型与常量（规格 docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md §4）。
 * 官方接口路径与字段名集中在本文件，单点修（§8）。
 * 纯类型 + 常量 + 无副作用提取器，客户端可安全 import。
 */

/** 本机反代基址（随应用启动；登录态 Cookie 落在 localhost:3778 域） */
export const CVS_PROXY_BASE = "http://localhost:3778";

/** 官方机位编号 → 中文名（与官方 SPA 播放器一致，侦察 3415 chunk） */
export const CVS_VIEW_NAMES: Record<number, string> = {
  1: "教师1",
  2: "教师2",
  3: "学生1",
  4: "学生2",
  5: "PPT",
  6: "电子教鞭",
};

/** 落库后的课程（左栏卡片用；字段与 classroom_courses 表列一一对应） */
export type ClassroomCourse = {
  id: number;
  tecl_id: string;
  subj_name: string;
  tecl_name: string;
  tecl_code: string;
  term: string;
  teac_names: string; // JSON 数组字符串
  cover_url: string;
  lesson_count: number;
  created_at: number;
};

/** 落库后的课时（课时表用；字段与 classroom_lessons 表列一一对应） */
export type ClassroomLesson = {
  id: number;
  course_id: number;
  cour_id: string;
  title: string;
  seq: number;
  begin_time: string;
  vod_status: number | null;
  duration_sec: number | null;
};

/** 官方 teachingclass/list 单条课程（前端经反代拉取后原样提交给 sync API） */
export type CvsCourseItem = {
  teclId?: unknown;
  subjId?: unknown;
  subjName?: unknown;
  teclName?: unknown;
  teclCode?: unknown;
  acteName?: unknown;
  teacNames?: unknown;
  teclImgUrl?: unknown;
  [k: string]: unknown;
};

/** 官方 subject_vod_list_new 单条课时（records[] 元素） */
export type CvsLessonItem = {
  id?: unknown;
  courBeginTime?: unknown;
  letiNumber?: unknown;
  vodStatus?: unknown;
  durationSec?: unknown;
  courseName?: unknown;
  [k: string]: unknown;
};

/** 官方 course_vod_videoinfos 返回的单路机位 */
export type CvsVodView = { viewNum: number; url: string };

/**
 * 官方列表响应的通用提取：按序尝试 data.records → data.list → data(数组) → 根数组。
 * 找不到返回 []（调用方据此判定「结构变化」并拒绝落库）。
 */
export function extractListItems(json: unknown): unknown[] {
  const obj = (json ?? null) as Record<string, unknown> | null;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const data = obj.data as Record<string, unknown> | null | undefined;
    if (data && typeof data === "object") {
      for (const key of ["records", "list"]) {
        const v = data[key];
        if (Array.isArray(v)) return v;
      }
      if (Array.isArray(data)) return data as unknown[];
    }
    if (Array.isArray(obj.data)) return obj.data as unknown[];
  }
  if (Array.isArray(json)) return json as unknown[];
  return [];
}

/** 播放机位提取：data.courseVodViewList → 根 courseVodViewList；只留有非空 url 的 */
export function extractVodViews(json: unknown): CvsVodView[] {
  const obj = (json ?? null) as Record<string, unknown> | null;
  let list: unknown = undefined;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const data = obj.data as Record<string, unknown> | null | undefined;
    if (data && typeof data === "object" && Array.isArray(data.courseVodViewList)) {
      list = data.courseVodViewList;
    } else if (Array.isArray(obj.courseVodViewList)) {
      list = obj.courseVodViewList;
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => {
      const o = (v ?? null) as { viewNum?: unknown; url?: unknown } | null;
      return o ? { viewNum: Number(o.viewNum) || 0, url: String(o.url ?? "") } : null;
    })
    .filter((v): v is CvsVodView => Boolean(v && v.url));
}
