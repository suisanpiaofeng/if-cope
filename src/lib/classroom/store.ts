/**
 * 课堂专区 v3 数据访问（规格 §4）。
 * 只封装 classroom_courses / classroom_lessons 读写；user_id 统一取默认用户（本地 demo），多用户就绪（D6）。
 * 同步落库前校验官方关键字段，结构不符整体 throw，不写半包（§8）。
 */
import db, { DEFAULT_USER } from "@/lib/db";
import type { ClassroomCourse, ClassroomLesson, CvsCourseItem, CvsLessonItem } from "./types";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 批量落库课程（幂等：同 user_id+tecl_id 走 UPDATE，不重建 id） */
export function upsertCourses(items: CvsCourseItem[]): { inserted: number; updated: number } {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("官方课程数据结构变化：无可同步的课程数据");
  }
  for (const it of items) {
    if (!it || !str(it.teclId) || !str(it.subjName)) {
      throw new Error("官方课程数据结构变化：缺少 teclId/subjName");
    }
  }
  const now = Date.now();
  const selectId = db.prepare(
    "SELECT id FROM classroom_courses WHERE user_id = ? AND tecl_id = ?"
  );
  const insert = db.prepare(
    `INSERT INTO classroom_courses
       (user_id, tecl_id, subj_id, subj_name, tecl_name, tecl_code, term, teac_names, cover_url, meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE classroom_courses
        SET subj_id = ?, subj_name = ?, tecl_name = ?, tecl_code = ?, term = ?,
            teac_names = ?, cover_url = ?, meta_json = ?, updated_at = ?
      WHERE id = ?`
  );
  let inserted = 0;
  let updated = 0;
  db.pragma("foreign_keys = ON");
  const run = db.transaction(() => {
    for (const it of items) {
      const teclId = str(it.teclId);
      const teacNames = Array.isArray(it.teacNames)
        ? JSON.stringify(it.teacNames.map((n) => str(n)))
        : "[]";
      const exist = selectId.get(DEFAULT_USER, teclId) as { id: number } | undefined;
      if (exist) {
        update.run(
          str(it.subjId),
          str(it.subjName),
          str(it.teclName),
          str(it.teclCode),
          str(it.acteName),
          teacNames,
          str(it.teclImgUrl),
          null,
          now,
          exist.id
        );
        updated++;
      } else {
        insert.run(
          DEFAULT_USER,
          teclId,
          str(it.subjId),
          str(it.subjName),
          str(it.teclName),
          str(it.teclCode),
          str(it.acteName),
          teacNames,
          str(it.teclImgUrl),
          null,
          now,
          now
        );
        inserted++;
      }
    }
  });
  run();
  return { inserted, updated };
}

/** 课程列表（含课时数；q 对课程名/教学班/编号/学期 LIKE 过滤） */
export function listCourses(q?: string): ClassroomCourse[] {
  const kw = (q ?? "").trim();
  const like = `%${kw}%`;
  const sql = `SELECT c.id, c.tecl_id, c.subj_name, c.tecl_name, c.tecl_code, c.term,
                      c.teac_names, c.cover_url, c.created_at,
                      (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id) AS lesson_count
               FROM classroom_courses c
               WHERE c.user_id = ? AND (? = '' OR c.subj_name LIKE ? OR c.tecl_name LIKE ?
                                       OR c.tecl_code LIKE ? OR c.term LIKE ?)
               ORDER BY c.updated_at DESC`;
  return db
    .prepare(sql)
    .all(DEFAULT_USER, kw, like, like, like, like) as ClassroomCourse[];
}

export function getCourse(id: number): ClassroomCourse | undefined {
  return db
    .prepare(
      `SELECT c.id, c.tecl_id, c.subj_name, c.tecl_name, c.tecl_code, c.term,
              c.teac_names, c.cover_url, c.created_at,
              (SELECT COUNT(*) FROM classroom_lessons l WHERE l.course_id = c.id) AS lesson_count
       FROM classroom_courses c WHERE c.id = ? AND c.user_id = ?`
    )
    .get(id, DEFAULT_USER) as ClassroomCourse | undefined;
}

/** 删课程（级联删课时，依赖 ON DELETE CASCADE + 外键开启） */
export function deleteCourse(id: number): void {
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM classroom_courses WHERE id = ? AND user_id = ?").run(id, DEFAULT_USER);
}

/** 整体替换该课程课时（事务：先删后插；title = 日期 + 第N节） */
export function replaceLessons(courseId: number, items: CvsLessonItem[]): { inserted: number } {
  for (const it of items) {
    if (!it || !str(it.id)) throw new Error("官方课时数据结构变化：缺少 id");
  }
  const now = Date.now();
  db.pragma("foreign_keys = ON");
  const del = db.prepare("DELETE FROM classroom_lessons WHERE course_id = ?");
  const ins = db.prepare(
    `INSERT INTO classroom_lessons
       (course_id, user_id, cour_id, title, seq, begin_time, vod_status, duration_sec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(courseId);
    items.forEach((it, i) => {
      const begin = str(it.courBeginTime);
      const title = `${begin.slice(0, 10)} 第${str(it.letiNumber) || "?"}节`;
      const status = it.vodStatus == null || it.vodStatus === "" ? null : Number(it.vodStatus);
      const dur = it.durationSec == null || it.durationSec === "" ? null : Number(it.durationSec);
      ins.run(
        courseId,
        DEFAULT_USER,
        str(it.id),
        title,
        i,
        begin,
        Number.isFinite(status as number) ? status : null,
        Number.isFinite(dur as number) ? dur : null,
        now,
        now
      );
    });
  })();
  return { inserted: items.length };
}

/** 课时列表（按 begin_time 正序 = 第1讲→第N讲；拉取序为倒序，seq 保留原序仅作兑底） */
export function listLessons(courseId: number): ClassroomLesson[] {
  return db
    .prepare(
      `SELECT id, course_id, cour_id, title, seq, begin_time, vod_status, duration_sec
       FROM classroom_lessons WHERE course_id = ? AND user_id = ? ORDER BY begin_time ASC, seq ASC`
    )
    .all(courseId, DEFAULT_USER) as ClassroomLesson[];
}
