/**
 * 技能存储（三期规格 §3.1/§3.2，plan Task 1/2）。
 * SKILL.md 式技能指令包：frontmatter（name/description/enabled）+ Markdown 正文。
 * 单一数据源 = data/skills/<name>/SKILL.md；技能只是指令，不执行任何代码。
 * 本文件 Task 1 先落解析层（纯函数，可被 verify 直测）；IO 层 Task 2 追加。
 */
import fs from "node:fs";
import path from "node:path";

export const BODY_MAX = 8000;
export const DESC_MAX = 300;

export type ParsedSkill = {
  name: string;
  description: string;
  enabled: boolean;
  body: string;
  triggers?: string;
  params?: string;
  error?: string;
};

/** 技能名校验：小写字母/数字/连字符，1~40 位（防路径穿越） */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(String(name ?? ""));
}

/** 解析 SKILL.md 文本。name 恒取目录名（覆盖 frontmatter）；坏文件返回 error 条目（enabled 强制 false）。
 *  正文/描述保全量（管理界面回写不丢数据）；对模型的截断在暴露点做（executeLoadSkill / buildSkillsIndexText） */
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

  const description = meta.description ?? "";
  const enabled = (meta.enabled ?? "true").trim().toLowerCase() !== "false";
  const body = lines.slice(end + 1).join("\n").trim();
  return { name: String(dirName), description, enabled, body, triggers: meta.triggers, params: meta.params };
}

/** 索引段文本（注入系统提示）：只收 enabled && !error；无可用技能返回 "" */
export function buildSkillsIndexText(skills: ParsedSkill[]): string {
  const usable = (skills ?? []).filter((s) => s.enabled && !s.error);
  if (!usable.length) return "";
  const lines = [
    "<skills>",
    "你有以下技能（可复用的任务指令包）。当学生的任务匹配某技能的 description 时，先调用 load_skill 加载该技能正文，然后严格按其步骤执行；不匹配的技能不要加载。",
    ...usable.map((s, i) => `${i + 1}. ${s.name} — ${s.description.slice(0, DESC_MAX)}`),
    "</skills>",
  ];
  return lines.join("\n");
}

/** load_skill 工具定义（chat 的 TOOLS 与 ask 的 MAP_TOOLS 共用一份） */
export const SKILL_TOOL = {
  type: "function",
  function: {
    name: "load_skill",
    description: "加载一个技能（SKILL.md 任务指令包）的完整正文。当学生的任务匹配 <skills> 索引中某技能的 description 时，先加载并遵循其步骤执行",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名（从 <skills> 索引里选）" } },
      required: ["name"],
    },
  },
} as const;

/** 执行 load_skill：命中返回正文；本次任务已加载过则去重提示；未知/禁用 throw（信息含可用清单，失败不记去重） */
export function executeLoadSkill(args: Record<string, unknown>, ctx: { loadedSkills?: Set<string> }): string {
  const name = String(args?.name ?? "").trim();
  if (!name) throw new Error("缺少技能名 name");
  if (ctx?.loadedSkills?.has(name)) {
    return `技能《${name}》已在本次任务中加载过，请直接遵循其步骤，无需重复加载`;
  }
  const usable = listSkills().filter((s) => s.enabled && !s.error);
  const skill = usable.find((s) => s.name === name);
  if (!skill) {
    throw new Error(`技能「${name}」不存在或已禁用。当前可用技能：${usable.map((s) => s.name).join("、") || "（无）"}`);
  }
  ctx?.loadedSkills?.add(name);
  const body = skill.body.length > BODY_MAX ? skill.body.slice(0, BODY_MAX) + "……（已截断）" : skill.body;
  return `技能《${name}》正文：\n\n${body}`;
}

// ── IO 层（Task 2）：data/skills/<name>/SKILL.md 单一数据源 ──

/** 技能根目录：env 覆盖供 verify 测试隔离；默认 data/skills */
export function skillsDir(): string {
  return process.env.IFCOPE_SKILLS_DIR ?? path.join(process.cwd(), "data", "skills");
}

/** 解析技能目录绝对路径；名称非法或越界 throw（路径穿越双保险） */
function resolveSkillDir(name: string): string {
  if (!isValidSkillName(name)) throw new Error(`非法技能名：「${name}」`);
  const root = path.resolve(skillsDir());
  const dir = path.resolve(root, name);
  if (!dir.startsWith(root + path.sep)) throw new Error(`非法技能名：「${name}」`);
  return dir;
}

/** 播种示例技能：只看 .seeded 标记，只播一次（UI 删除后不复活） */
export function ensureSeedSkills(): void {
  const root = skillsDir();
  const marker = path.join(root, ".seeded");
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(root, { recursive: true });
  writeSkill(
    "exam-plan",
    "生成复习计划/备考安排时使用（当学生问“怎么复习”“帮我排计划”“期末怎么准备”）",
    `# 复习计划制定

按以下步骤为学生制定复习计划：

1. **诊断现状**：明确考试科目、考试时间、当前掌握程度（资料库有相关资料时用 list_library / read_source 了解内容）
2. **拆分阶段**：按周拆分——基础回顾 / 重点强化 / 真题演练 / 考前收心，各阶段给出天数
3. **每日任务**：每阶段列出具体每日任务（科目 + 内容 + 时长），总量控制在学生可执行范围
4. **复盘节奏**：约定复盘点（如每周日晚回顾完成率），给出调整规则
5. **输出格式**：用表格呈现每日任务，结尾给一句鼓励和首要行动

约束：计划基于学生真实时间，不要假设每天 8 小时；缺关键信息先问，不编造考试信息。`
  );
  fs.writeFileSync(marker, "");
}

/** 全部技能（含坏文件 error 条目）；TTL 3s 缓存（P2 T1），refresh=true 强刷 */
let cache: { at: number; skills: ParsedSkill[] } | null = null;
const CACHE_TTL = 3000;

export function invalidateSkillsCache(): void {
  cache = null;
}

export function listSkills(refresh: boolean = false): ParsedSkill[] {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL) return cache.skills;
  ensureSeedSkills();
  const root = skillsDir();
  if (!fs.existsSync(root)) return [];
  const out: ParsedSkill[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    out.push(parseSkillFile(fs.readFileSync(file, "utf8"), entry.name));
  }
  cache = { at: Date.now(), skills: out };
  return out;
}

/** 读技能正文；不存在/禁用/坏文件 throw（中文信息含原因） */
export function readSkillBody(name: string): string {
  const dir = resolveSkillDir(name);
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) throw new Error(`技能「${name}」不存在`);
  const skill = parseSkillFile(fs.readFileSync(file, "utf8"), name);
  if (skill.error) throw new Error(`技能「${name}」不可用：${skill.error}`);
  if (!skill.enabled) throw new Error(`技能「${name}」已禁用`);
  return skill.body;
}

/** 写技能（幂等覆盖）；name 非法 throw；triggers/params 可选写入 frontmatter */
export function writeSkill(
  name: string,
  description: string,
  body: string,
  enabled: boolean = true,
  extra?: { triggers?: string; params?: string }
): void {
  const dir = resolveSkillDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const metaLines = [
    `name: ${name}`,
    `description: ${String(description ?? "").replace(/\r?\n/g, " ").trim()}`,
    `enabled: ${enabled ? "true" : "false"}`,
  ];
  if (extra?.triggers?.trim()) metaLines.push(`triggers: ${extra.triggers.trim()}`);
  if (extra?.params?.trim()) metaLines.push(`params: ${extra.params.trim()}`);
  const text = `---\n${metaLines.join("\n")}\n---\n${String(body ?? "").trim()}\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), text);
  invalidateSkillsCache();
}

/** 删技能目录；不存在返回 false（路由据此 404）；name 非法 throw */
export function deleteSkill(name: string): boolean {
  const dir = resolveSkillDir(name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  invalidateSkillsCache();
  return true;
}

/** 可用技能的索引段（注入系统提示）；无可用技能返回 "" */
export function skillsIndexText(): string {
  return buildSkillsIndexText(listSkills());
}
