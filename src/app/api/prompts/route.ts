import { NextRequest, NextResponse } from "next/server";
import { PROMPT_DEFAULTS, resolvePrompt, setPromptOverride, getPromptOverride, type PromptKey } from "@/lib/prompts";

export const runtime = "nodejs";

const KEYS = Object.keys(PROMPT_DEFAULTS) as PromptKey[];

/** 5 场景提示词全量（默认 + 当前覆盖）：GET /api/prompts */
export async function GET() {
  return NextResponse.json({
    items: KEYS.map((key) => ({
      key,
      default: PROMPT_DEFAULTS[key],
      override: getPromptOverride(key),
    })),
  });
}

/** 写覆盖：PUT { key, content }（空串/空白 = 清除覆盖回默认） */
export async function PUT(req: NextRequest) {
  let body: { key?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const key = body.key as PromptKey;
  if (!KEYS.includes(key)) {
    return NextResponse.json({ error: `key 必须是 ${KEYS.join("/") } 之一` }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content 必须是字符串" }, { status: 400 });
  }
  setPromptOverride(key, body.content);
  return NextResponse.json({ ok: true, effective: resolvePrompt(key, PROMPT_DEFAULTS[key]) });
}
