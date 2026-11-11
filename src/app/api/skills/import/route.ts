import { NextRequest, NextResponse } from "next/server";
import { listSkills, writeSkill } from "@/lib/agent/skills";
import { planImport, type ImportItem } from "@/lib/agent/skillImport";

export const runtime = "nodejs";

/** skill 导入（harness P0 §2.2，两步式）：
 *  预检（无 resolutions）遇冲突 → 409 返回 conflicts 供前端弹窗逐项决策；
 *  带 resolutions 提交 → overwrite/rename/skip 落盘。单文件 = items 长度 1；文件夹 = 前端递归收集全部 .md。 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    items?: ImportItem[];
    resolutions?: Record<string, "overwrite" | "rename" | "skip">;
  };
  const items = body.items ?? [];
  if (!items.length) return NextResponse.json({ error: "items 不能为空" }, { status: 400 });
  if (items.length > 200) return NextResponse.json({ error: "单次最多导入 200 个文件" }, { status: 400 });
  for (const it of items) {
    if (typeof it?.path !== "string" || typeof it?.content !== "string") {
      return NextResponse.json({ error: "items 项必须含 path/content 字符串" }, { status: 400 });
    }
  }

  const existing = listSkills();
  const plan = planImport(items, existing.map((s) => s.name), body.resolutions ?? {});

  if (plan.conflicts.length) {
    return NextResponse.json(
      {
        ok: [],
        conflicts: plan.conflicts.map((c) => ({
          path: c.path,
          name: c.name,
          description: c.description,
          existing: existing.find((s) => s.name === c.name) ?? { name: c.name, description: "" },
        })),
        errors: plan.errors,
      },
      { status: 409 }
    );
  }

  const installed: string[] = [];
  for (const ins of plan.installs) {
    // overwrite 保留原 enabled（规格 §2.2），其余按解析值
    const prev = ins.overwrite ? existing.find((s) => s.name === ins.name) : undefined;
    writeSkill(ins.name, ins.description, ins.body, prev ? prev.enabled : ins.enabled, {
      triggers: ins.triggers,
      params: ins.params,
    });
    installed.push(ins.name);
  }

  return NextResponse.json({
    ok: true,
    installed,
    renamed: plan.renames,
    skipped: plan.skipped,
    errors: plan.errors,
  });
}
