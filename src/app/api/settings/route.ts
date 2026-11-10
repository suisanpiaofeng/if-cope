import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, setSettings, ModelSettings } from "@/lib/db";
import { normalizeBaseUrl, providerFor, testModelConnection } from "@/lib/modelGateway";
import { rebuildEmbeddingIndex } from "@/lib/embed";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const s = getSettings();
  return NextResponse.json({
    ...s,
    apiKey: s.apiKey ? `****${s.apiKey.slice(-4)}` : "",
    hasKey: Boolean(s.apiKey),
    translateApiKey: s.translateApiKey ? `****${s.translateApiKey.slice(-4)}` : "",
    hasTranslateKey: Boolean(s.translateApiKey),
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<ModelSettings> & {
    apiKey?: string;
    embeddingDimension?: number;
    rebuildIndex?: boolean;
  };
  const current = getSettings();
  const baseUrl = normalizeBaseUrl(body.baseUrl ?? current.baseUrl);
  const embedModel = (body.embedModel ?? current.embedModel).trim();
  const embeddingDimension =
    Number(body.embeddingDimension ?? current.embeddingDimension ?? 0) || 0;

  const next: ModelSettings = {
    ...current,
    baseUrl,
    apiKey:
      body.apiKey && !body.apiKey.startsWith("****")
        ? body.apiKey.trim()
        : current.apiKey,
    chatModel: (body.chatModel ?? current.chatModel).trim(),
    embedModel,
    provider: providerFor(baseUrl),
    embeddingDimension: embedModel ? embeddingDimension : 0,
    verifiedAt: body.embeddingDimension != null || body.apiKey ? Date.now() : current.verifiedAt,
    // 翻译用途上游：字段存在才更新（空串 = 清除回退对话模型；遮罩 Key 保持原值）
    ...(body.translateBaseUrl !== undefined && {
      translateBaseUrl: normalizeBaseUrl(String(body.translateBaseUrl)),
    }),
    ...(body.translateApiKey !== undefined && {
      translateApiKey: String(body.translateApiKey).startsWith("****")
        ? current.translateApiKey
        : String(body.translateApiKey).trim(),
    }),
    ...(body.translateModel !== undefined && { translateModel: String(body.translateModel).trim() }),
    // 用户级指令（个性化）：字段存在才更新（空串 = 清除）
    ...(body.userDirective !== undefined && { userDirective: String(body.userDirective).trim() }),
  };

  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "Base URL 必须以 http(s):// 开头" }, { status: 400 });
  }

  const embeddingChanged = current.embedModel !== next.embedModel;
  setSettings(next);

  // 手动重建：用当前生效的嵌入路径（本地模型或远程）重刷所有向量
  if (body.rebuildIndex) {
    try {
      const rebuilt = await rebuildEmbeddingIndex(next);
      return NextResponse.json({ ok: true, rebuiltEmbeddings: rebuilt });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        saved: true,
        rebuiltEmbeddings: 0,
        error: `配置已保存，但重建索引失败：${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  // 嵌入模型是索引契约的一部分。更换后原地重建已有分块，避免新旧向量混用。
  if (embeddingChanged) {
    try {
      const rebuilt = await rebuildEmbeddingIndex(next);
      return NextResponse.json({ ok: true, rebuiltEmbeddings: rebuilt });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        saved: true,
        rebuiltEmbeddings: 0,
        error: `配置已保存，但重建已有索引失败：${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, rebuiltEmbeddings: 0 });
}

/** 验证 Key、模型列表、词来额度和 embedding 维度，不写入配置。 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    baseUrl?: string;
    apiKey?: string;
    chatModel?: string;
    embedModel?: string;
  };
  const suppliedKey = (body.apiKey ?? "").trim();
  const apiKey = suppliedKey && !suppliedKey.startsWith("****")
    ? suppliedKey
    : getSettings().apiKey;
  const result = await testModelConnection({
    baseUrl: body.baseUrl ?? "",
    apiKey,
    chatModel: body.chatModel,
    embedModel: body.embedModel,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE() {
  db.prepare("DELETE FROM settings WHERE key = 'model'").run();
  return NextResponse.json({ ok: true });
}

