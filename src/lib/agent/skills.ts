/**
 * 技能存储（三期规格 §3.1/§3.2，plan Task 1/2）。
 * SKILL.md 式技能指令包：frontmatter（name/description/enabled）+ Markdown 正文。
 * 单一数据源 = data/skills/<name>/SKILL.md；技能只是指令，不执行任何代码。
 * 本文件 Task 1 先落解析层（纯函数，可被 verify 直测）；IO 层 Task 2 追加。
 */

export const BODY_MAX = 8000;
export const DESC_MAX = 300;

export type ParsedSkill = {
  name: string;
  description: string;
  enabled: boolean;
  body: string;
  error?: string;
};

/** 技能名校验：小写字母/数字/连字符，1~40 位（防路径穿越） */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(String(name ?? ""));
}

/** 解析 SKILL.md 文本。name 恒取目录名（覆盖 frontmatter）；坏文件返回 error 条目（enabled 强制 false） */
export function parseSkillFile(text: string, dirName: string): ParsedSkill {
  const err = (error: string): ParsedSkill => ({
    name: String(dirName ?? ""),
    description: "",
    enabled: false,
    body: "",
    error,
  });

  if (!isValidSkillName(dirName)) return err("目录名非法");

  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return err("缺少 frontmatter");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return err("缺少 frontmatter");

  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  if (!meta.name) return err("缺少 name 字段");

  const description = (meta.description ?? "").slice(0, DESC_MAX);
  const enabled = (meta.enabled ?? "true").trim().toLowerCase() !== "false";
  let body = lines.slice(end + 1).join("\n").trim();
  if (body.length > BODY_MAX) body = body.slice(0, BODY_MAX) + "……（已截断）";
  return { name: String(dirName), description, enabled, body };
}

/** 索引段文本（注入系统提示）：只收 enabled && !error；无可用技能返回 "" */
export function buildSkillsIndexText(skills: ParsedSkill[]): string {
  const usable = (skills ?? []).filter((s) => s.enabled && !s.error);
  if (!usable.length) return "";
  const lines = [
    "<skills>",
    "你有以下技能（可复用的任务指令包）。当学生的任务匹配某技能的 description 时，先调用 load_skill 加载该技能正文，然后严格按其步骤执行；不匹配的技能不要加载。",
    ...usable.map((s, i) => `${i + 1}. ${s.name} — ${s.description}`),
    "</skills>",
  ];
  return lines.join("\n");
}
