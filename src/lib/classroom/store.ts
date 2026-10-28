/**
 * 课堂专区 v2 数据访问（规格 §3）。
 * 只封装 classroom_* 表读写；user_id 统一取默认用户（本地 demo），多用户就绪（D6）。
 */
import db, { DEFAULT_USER } from "@/lib/db";
import type {
  ClassroomCourse,
  ClassroomLesson,
  CourseDigest,
  LessonNote,
  LessonNoteStatus,
} from "./types";

/** 登记课程（幂等：同 cvs_course_id 更新名称/学期，不重建） */
export function upsertCourse(input: {
  cvsCourseId: string;
  name: string;
  term?: string;
  teacher?: string;
}): number {
  const now = Date.now();
  const existing = db
    .prepare("SELECT id FROM classroom_courses WHERE user_id = ? AND cvs_course_id = ?")
    .get(DEFAULT_USER, input.cvsCourseId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE classroom_courses SET name = ?, term = ?, teacher = ?, updated_at = ? WHERE id = ?"
    ).run(input.name, input.term ?? "", input.teacher ?? "", now, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO classroom_courses (user_id, cvs_course_id, name, term, teacher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(DEFAULT_USER, input.cvsCourseId, input.name, input.term ?? "", input.teacher ?? "", now, now);
  return Number(info.lastInsertRowid);
}

/** 课程列表（含课时数/已生成笔记数） */
export function listCourses(): ClassroomCourse[] {
  return db
    .prepare(
      `SELECT c.id, c.cvs_course_id, c.name, c.term, c.teacher, c.created_at,
              (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id) AS lesson_count,
              (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id AND l.note_status = 'done') AS processed_count
       FROM classroom_courses c
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(DEFAULT_USER) as ClassroomCourse[];
}

export function getCourse(id: number): ClassroomCourse | undefined {
  return db
    .prepare(
      `SELECT c.id, c.cvs_course_id, c.name, c.term, c.teacher, c.created_at,
              (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id) AS lesson_count,
              (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id AND l.note_status = 'done') AS processed_count
       FROM classroom_courses c WHERE c.id = ? AND c.user_id = ?`
    )
    .get(id, DEFAULT_USER) as ClassroomCourse | undefined;
}

/** 删课程（级联删课时/笔记/手册，依赖 ON DELETE CASCADE + 外键开启） */
export function deleteCourse(id: number): void {
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM classroom_courses WHERE id = ? AND user_id = ?").run(id, DEFAULT_USER);
}

/** 写入/更新课时（幂等：同 cvs_lesson_id 更新标题/排序/回放链接） */
export function upsertLesson(input: {
  courseId: number;
  cvsLessonId: string;
  title: string;
  seq: number;
  replayUrl?: string;
  vodStatus?: number | null;
  durationSec?: number | null;
}): number {
  const now = Date.now();
  const existing = db
    .prepare("SELECT id FROM classroom_lessons WHERE user_id = ? AND cvs_lesson_id = ?")
    .get(DEFAULT_USER, input.cvsLessonId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE classroom_lessons SET course_id = ?, title = ?, seq = ?, replay_url = ?,
       vod_status = ?, duration_sec = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.courseId,
      input.title,
      input.seq,
      input.replayUrl ?? "",
      input.vodStatus ?? null,
      input.durationSec ?? null,
      now,
      existing.id
    );
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO classroom_lessons
       (course_id, user_id, cvs_lesson_id, title, seq, replay_url, vod_status, duration_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.courseId,
      DEFAULT_USER,
      input.cvsLessonId,
      input.title,
      input.seq,
      input.replayUrl ?? "",
      input.vodStatus ?? null,
      input.durationSec ?? null,
      now,
      now
    );
  return Number(info.lastInsertRowid);
}

/** 课时列表（按 seq 排序） */
export function listLessons(courseId: number): ClassroomLesson[] {
  return db
    .prepare(
      "SELECT * FROM classroom_lessons WHERE course_id = ? AND user_id = ? ORDER BY seq ASC, id ASC"
    )
    .all(courseId, DEFAULT_USER) as ClassroomLesson[];
}

export function getLesson(id: number): ClassroomLesson | undefined {
  return db
    .prepare("SELECT * FROM classroom_lessons WHERE id = ? AND user_id = ?")
    .get(id, DEFAULT_USER) as ClassroomLesson | undefined;
}

/** 更新课时笔记状态（唯一状态字段，规格 §3） */
export function setLessonNoteStatus(
  id: number,
  status: LessonNoteStatus,
  errorNote?: string
): void {
  db.prepare(
    "UPDATE classroom_lessons SET note_status = ?, error_note = ?, updated_at = ? WHERE id = ?"
  ).run(status, errorNote ?? "", Date.now(), id);
}

/** 读逐课笔记（UNIQUE(lesson_id) 至多一条） */
export function getLessonNote(lessonId: number): LessonNote | undefined {
  return db
    .prepare("SELECT * FROM classroom_notes WHERE lesson_id = ? AND user_id = ?")
    .get(lessonId, DEFAULT_USER) as LessonNote | undefined;
}

/** 写逐课笔记（幂等覆盖；重生成时 source_id 由调用方更新为新 RAG source） */
export function saveLessonNote(
  lessonId: number,
  contentMd: string,
  model: string,
  sourceId: number | null
): number {
  const now = Date.now();
  const existing = getLessonNote(lessonId);
  if (existing) {
    db.prepare(
      "UPDATE classroom_notes SET content_md = ?, model = ?, source_id = ?, updated_at = ? WHERE id = ?"
    ).run(contentMd, model, sourceId, now, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO classroom_notes (lesson_id, user_id, content_md, model, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(lessonId, DEFAULT_USER, contentMd, model, sourceId, now, now);
  return Number(info.lastInsertRowid);
}

/** 读期末手册（UNIQUE(course_id) 至多一条） */
export function getDigest(courseId: number): CourseDigest | undefined {
  return db
    .prepare("SELECT * FROM classroom_digests WHERE course_id = ? AND user_id = ?")
    .get(courseId, DEFAULT_USER) as CourseDigest | undefined;
}

/** 写期末手册（幂等覆盖） */
export function saveDigest(
  courseId: number,
  contentMd: string,
  model: string,
  sourceId: number | null
): number {
  const now = Date.now();
  const existing = getDigest(courseId);
  if (existing) {
    db.prepare(
      "UPDATE classroom_digests SET content_md = ?, model = ?, source_id = ?, updated_at = ? WHERE id = ?"
    ).run(contentMd, model, sourceId, now, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO classroom_digests (course_id, user_id, content_md, model, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(courseId, DEFAULT_USER, contentMd, model, sourceId, now, now);
  return Number(info.lastInsertRowid);
}
