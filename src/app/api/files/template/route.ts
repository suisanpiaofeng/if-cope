import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { workspaceRoot, resolveInWorkspace } from "@/lib/agent/workspace";

export const runtime = "nodejs";

const SUBDIRS = ["讲义", "作业", "错题本", "复习计划"];

const NOTE_TEMPLATE = `# 错题本

> 用法：把错题按「题目 / 错因 / 正解 / 同类题提醒」记录；可让 AI 直接帮你整理到这里。

`;

const PLAN_TEMPLATE = `# 复习计划

> 用法：让 AI 依据你的考试安排生成计划，或自己按周填写。

`;

/** 课程空间模板（harness P3-3 §4.2）：<课程>/{讲义,作业,错题本,复习计划} 骨架 + 两份起始模板 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string };
  const name = String(body.name ?? "").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  if (!name) return NextResponse.json({ error: "缺少课程名" }, { status: 400 });
  const root = workspaceRoot();
  for (const d of SUBDIRS) fs.mkdirSync(path.join(root, name, d), { recursive: true });
  if (!fs.existsSync(path.join(root, name, "错题本", "错题本.md"))) {
    fs.writeFileSync(path.join(root, name, "错题本", "错题本.md"), NOTE_TEMPLATE);
  }
  if (!fs.existsSync(path.join(root, name, "复习计划", "复习计划.md"))) {
    fs.writeFileSync(path.join(root, name, "复习计划", "复习计划.md"), PLAN_TEMPLATE);
  }
  return NextResponse.json({ ok: true, path: name, subdirs: SUBDIRS });
}
