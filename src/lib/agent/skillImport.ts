/**
 * skill 导入（harness P0 规格 §2.1/§2.2）：上传 .md/文件夹 → 元数据自动生成 → 两步式冲突处理。
 * 纯函数为主（verify-skill-import.mjs 直测）；落盘由 /api/skills/import 路由经 writeSkill 完成。
 */
import { isValidSkillName } from "./skills.ts";

export type ImportItem = { path: string; content: string };

export type ImportEntry = {
  path: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  triggers?: string;
  params?: string;
  overwrite?: boolean;
};

export type ImportPlan = {
  installs: ImportEntry[];
  conflicts: ImportEntry[];
  errors: Array<{ path: string; error: string }>;
  renames: Array<{ from: string; to: string }>;
  skipped: string[];
};

/** 文件路径 → 技能名 slug（小写/非 [a-z0-9-] 转 -/压连续 -/去首尾 -/截 40） */
export function deriveSkillName(filePath: string): string {
  const base = String(filePath ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").toLowerCase();
  return stem
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** 元数据自动生成：triggers 优先，否则正文首个非空行去 Markdown 标记 */
export function autoDescription(body: string, triggers?: string): string {
  const t = String(triggers ?? "").trim();
  if (t) return t.slice(0, 300);
  const first = String(body ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  return first
    .replace(/^[#>\s*]+/, "")
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 300);
}

type ParsedMeta = {
  name?: string;
  description?: string;
  enabled?: boolean;
  triggers?: string;
  params?: string;
  body: string;
};

/** 轻量解析：有 frontmatter 取元数据，无 frontmatter 整文即正文（导入容忍纯 md） */
function parseSource(content: string): ParsedMeta {
  const raw = String(content ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { body: raw.trim() };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return {
    name: meta.name,
    description: meta.description,
    enabled: meta.enabled == null ? true : meta.enabled.trim().toLowerCase() !== "false",
    triggers: meta.triggers,
    params: meta.params,
    body: lines.slice(end + 1).join("\n").trim(),
  };
}

function findFreeName(base: string, taken: Set<string>): string {
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}`;
    if (!taken.has(cand)) return cand;
  }
  return `${base}-${Date.now()}`;
}

/** 导入规划（两步式共用）：冲突（已存在/同批重复）无 resolution 进 conflicts；
 *  overwrite 进 installs（overwrite=true，enabled 由写入层保留原值）；rename 取首个空位；skip 丢弃。 */
export function planImport(
  items: ImportItem[],
  existingNames: string[],
  resolutions: Record<string, "overwrite" | "rename" | "skip"> = {}
): ImportPlan {
  const plan: ImportPlan = { installs: [], conflicts: [], errors: [], renames: [], skipped: [] };
  const taken = new Set((existingNames ?? []).map(String));
  for (const item of items ?? []) {
    const content = String(item.content ?? "");
    if (!content.trim()) {
      plan.errors.push({ path: item.path, error: "内容为空" });
      continue;
    }
    const meta = parseSource(content);
    const name = (meta.name ?? "").trim() || deriveSkillName(item.path);
    if (!isValidSkillName(name)) {
      plan.errors.push({ path: item.path, error: `无法生成合法技能名：「${name}」（仅允许小写字母/数字/连字符，≤40）` });
      continue;
    }
    const base: ImportEntry = {
      path: item.path,
      name,
      description: (meta.description ?? "").trim() || autoDescription(meta.body, meta.triggers),
      body: meta.body,
      enabled: meta.enabled !== false,
      triggers: meta.triggers,
      params: meta.params,
    };
    const conflict = taken.has(name);
    taken.add(name);
    if (!conflict) {
      plan.installs.push(base);
      continue;
    }
    const res = resolutions[item.path];
    if (!res) {
      plan.conflicts.push(base);
    } else if (res === "skip") {
      plan.skipped.push(item.path);
    } else if (res === "overwrite") {
      plan.installs.push({ ...base, overwrite: true });
    } else {
      const to = findFreeName(name, taken);
      taken.add(to);
      plan.renames.push({ from: name, to });
      plan.installs.push({ ...base, name: to });
    }
  }
  return plan;
}
