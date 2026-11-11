import { NextRequest, NextResponse } from "next/server";
import db, { getSettings, setSettings, ModelSettings } from "@/lib/db";
import { normalizeBaseUrl, providerFor, testModelConnection } from "@/lib/modelGateway";
import { rebuildEmbeddingIndex } from "@/lib/embed";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 对外视图：主 Key/翻译 Key/档内 Key 均遮罩（回传 **** 前缀不会覆盖真值） */
function publicView(s: ModelSettings) {
  return {
    ...s,
    apiKey: s.apiKey ? `****${s.apiKey.slice(-4)}` : "",
    hasKey: Boolean(s.apiKey),
    translateApiKey: s.translateApiKey ? `****${s.translateApiKey.slice(-4)}` : "",
    hasTranslateKey: Boolean(s.translateApiKey),
    profiles: (s.profiles ?? []).map((p) => ({ ...p, apiKey: p.apiKey ? `****${p.apiKey.slice(-4)}` : "" })),
  };
}

export async function GET() {
  return NextResponse.json(publicView(getSettings()));
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<ModelSettings> & {
    apiKey?: string;
    embeddingDimension?: number;
    rebuildIndex?: boolean;
    switchProfile?: string;
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
    // 确认模式（harness P0）：writes/all/none，非法值忽略
    ...(body.confirmMode !== undefined && ["writes", "all", "none"].includes(String(body.confirmMode))
      ? { confirmMode: String(body.confirmMode) as "writes" | "all" | "none" }
      : {}),
    // 生成参数（空串/null = 清除回默认）
    ...(body.temperature !== undefined && { temperature: body.temperature === null || body.temperature === ("" as unknown) ? undefined : Math.min(2, Math.max(0, Number(body.temperature))) }),
    ...(body.maxTokens !== undefined && { maxTokens: body.maxTokens === null || body.maxTokens === ("" as unknown) ? undefined : Math.max(1, Number(body.maxTokens) || 0) }),
    // 模型配置档（全量覆盖；档内遮罩 Key 保留原值）
    ...(body.profiles !== undefined && {
      profiles: (Array.isArray(body.profiles) ? body.profiles : []).map((p) => {
        const prof = p as { name?: string; baseUrl?: string; apiKey?: string; chatModel?: string; temperature?: number; maxTokens?: number };
        const old = current.profiles?.find((x) => x.name === prof.name);
        return {
          name: String(prof.name ?? "").slice(0, 40),
          baseUrl: normalizeBaseUrl(String(prof.baseUrl ?? "")),
          // 遮罩 Key：优先保留同名档原值；新建档回退主 Key（“存为新档”语义）；绝不落空串
          apiKey: prof.apiKey && !prof.apiKey.startsWith("****")
            ? String(prof.apiKey).trim()
            : old?.apiKey || current.apiKey || "",
          chatModel: String(prof.chatModel ?? "").trim(),
          temperature: prof.temperature == null ? undefined : Math.min(2, Math.max(0, Number(prof.temperature))),
          maxTokens: prof.maxTokens == null ? undefined : Math.max(1, Number(prof.maxTokens) || 0),
        };
      }),
    }),
    ...(body.activeProfile !== undefined && { activeProfile: String(body.activeProfile).slice(0, 40) }),
    // 切档：服务端物化——从已存档取真 Key，主字段整体切换（遮罩 Key 不出服务端）
    ...(body.switchProfile !== undefined && (() => {
      const name = String(body.switchProfile).slice(0, 40);
      const prof = current.profiles?.find((p) => p.name === name);
      if (!prof) return {};
      return {
        activeProfile: name,
        baseUrl: prof.baseUrl,
        apiKey: prof.apiKey,
        chatModel: prof.chatModel,
        temperature: prof.temperature,
        maxTokens: prof.maxTokens,
      };
    })()),
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
      return NextResponse.json({ ok: true, rebuiltEmbeddings: rebuilt, ...publicView(next) });
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
      return NextResponse.json({ ok: true, rebuiltEmbeddings: rebuilt, ...publicView(next) });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        saved: true,
        rebuiltEmbeddings: 0,
        error: `配置已保存，但重建已有索引失败：${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, rebuiltEmbeddings: 0, ...publicView(next) });
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

