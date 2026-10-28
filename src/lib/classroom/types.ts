/**
 * 课堂专区 v2 类型（规格 docs/课堂专区-架构规格-v2-20261028.md §3）。
 * 纯类型 + 常量，客户端可安全 import；不含服务端依赖。
 */

/** 课时笔记状态（v2 唯一状态字段，无多阶段状态机） */
export type LessonNoteStatus = "none" | "done" | "failed";

export type ClassroomCourse = {
  id: number;
  cvs_course_id: string;
  name: string;
  term: string;
  teacher: string;
  lesson_count: number;
  processed_count: number;
  created_at: number;
};

export type ClassroomLesson = {
  id: number;
  course_id: number;
  cvs_lesson_id: string;
  title: string;
  seq: number;
  replay_url: string;
  vod_status: number | null;
  duration_sec: number | null;
  note_status: LessonNoteStatus;
  error_note: string;
  created_at: number;
};

/** 逐课笔记（每课时一条，UNIQUE(lesson_id) 幂等覆盖） */
export type LessonNote = {
  id: number;
  lesson_id: number;
  content_md: string;
  model: string;
  source_id: number | null;
  created_at: number;
};

/** 期末复习手册（每课程一条，可重生成） */
export type CourseDigest = {
  id: number;
  course_id: number;
  content_md: string;
  model: string;
  source_id: number | null;
  created_at: number;
};

/** 转写片段（AI 字幕/手动文本统一结构） */
export type TranscriptSegment = { start: number; end: number; text: string };
