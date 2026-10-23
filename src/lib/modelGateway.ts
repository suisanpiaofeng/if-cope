import type { ModelSettings } from "./db";

export type ProviderSource = "iflink" | "custom";

export type ConnectionTest = {
  ok: boolean;
  baseUrl: string;
  provider: ProviderSource;
  models: string[];
  quota?: { amount: string | null; used: string | null };
  chatModelChecked: boolean;
  chatModelAvailable: boolean;
  embedModelChecked: boolean;
  embedDimension: number | null;
  warnings: string[];
  error?: string;
};

/** 把用户粘贴的链接统一成 OpenAI 兼容 Base URL。
 *  支持根地址、/v1、以及误粘的 /chat/completions 等具体接口地址。 */
export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .replace(/\/+(?:chat\/completions|embeddings|models|dashboard(?:\/|$).*)$/i, "/")
    .replace(/\/+$/, "");
  if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function modelEndpoint(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl).replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export function providerFor(baseUrl: string): ProviderSource {
  try {
    const host = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
    return host === "iflink.tech" || host.endsWith(".iflink.tech") ? "iflink" : "custom";
  } catch {
    return "custom";
  }
}

export function modelHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey.trim()}`,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchJson(url: string, apiKey: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...modelHeaders(apiKey), ...(init.headers as Record<string, string> | undefined) },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 连接测试：验证 Key、模型列表、词来额度，并用一个极短 embedding 请求确认向量维度。 */
export async function testModelConnection(input: {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  embedModel?: string;
}): Promise<ConnectionTest> {
  let baseUrl = "";
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch {
    return {
      ok: false,
      baseUrl: input.baseUrl.trim(),
      provider: "custom",
      models: [],
      chatModelChecked: Boolean(input.chatModel?.trim()),
      chatModelAvailable: false,
      embedModelChecked: Boolean(input.embedModel?.trim()),
      embedDimension: null,
      warnings: [],
      error: "Base URL 不是有效的 http(s) 地址。",
    };
  }
  const apiKey = input.apiKey.trim();
  const chatModel = input.chatModel?.trim() ?? "";
  const embedModel = input.embedModel?.trim() ?? "";
  const provider = providerFor(baseUrl);
  const warnings: string[] = [];

  let models: string[] = [];
  let quota: ConnectionTest["quota"];
  let chatModelAvailable = false;
  let embedDimension: number | null = null;

  try {
    const modelsRes = await fetchJson(modelEndpoint(baseUrl, "models"), apiKey);
    if (modelsRes.ok) {
      const payload = await readJson(modelsRes);
      models = ((payload as { data?: Array<{ id?: string }> }).data ?? [])
        .map((m) => m.id ?? "")
        .filter(Boolean);
      chatModelAvailable = !chatModel || models.includes(chatModel);
      if (chatModel && models.length && !chatModelAvailable) {
        warnings.push(`模型列表中未找到「${chatModel}」，仍可保存后实测。`);
      }
    } else {
      warnings.push(`GET /models 返回 HTTP ${modelsRes.status}；部分兼容网关不提供模型列表。`);
    }

    const [subRes, usageRes] = await Promise.all([
      fetchJson(modelEndpoint(baseUrl, "dashboard/billing/subscription"), apiKey),
      fetchJson(modelEndpoint(baseUrl, "dashboard/billing/usage"), apiKey),
    ]);

    if (subRes.ok) {
      const sub = (await readJson(subRes)) as {
        system_hard_limit_usd?: number;
        hard_limit_usd?: number;
      };
      const amount = sub.system_hard_limit_usd ?? sub.hard_limit_usd ?? null;
      quota = {
        amount: amount != null && amount > 9_999_999 ? "不限额" : amount?.toFixed(2) ?? null,
        used: quota?.used ?? null,
      };
    }
    if (usageRes.ok) {
      const usage = (await readJson(usageRes)) as { total_usage?: number };
      quota = {
        amount: quota?.amount ?? null,
        used: usage.total_usage != null ? (usage.total_usage / 100).toFixed(2) : null,
      };
    }

    if (embedModel) {
      const embedRes = await fetchJson(modelEndpoint(baseUrl, "embeddings"), apiKey, {
        method: "POST",
        body: JSON.stringify({ model: embedModel, input: "连接测试" }),
      });
      if (embedRes.ok) {
        const payload = (await readJson(embedRes)) as {
          data?: Array<{ embedding?: number[] }>;
        };
        embedDimension = payload.data?.[0]?.embedding?.length ?? null;
        if (!embedDimension) warnings.push("嵌入接口返回成功，但没有可读取的向量维度。");
      } else {
        const detail = (await embedRes.text()).slice(0, 200);
        warnings.push(`嵌入模型「${embedModel}」测试失败 HTTP ${embedRes.status}${detail ? `：${detail}` : ""}。`);
      }
    } else {
      warnings.push("未填写嵌入模型，资料入库会继续使用本地 mock 向量。");
    }

    const modelsOk = models.length > 0;
    const keyLikelyValid = modelsOk || quota != null || embedDimension != null;
    if (!keyLikelyValid && !modelsOk) {
      return {
        ok: false,
        baseUrl,
        provider,
        models,
        chatModelChecked: Boolean(chatModel),
        chatModelAvailable,
        embedModelChecked: Boolean(embedModel),
        embedDimension,
        warnings,
        error: "未能通过模型列表、额度或嵌入接口验证 Key，请检查 Base URL、Key 和网络。",
      };
    }

    return {
      ok: true,
      baseUrl,
      provider,
      models,
      quota,
      chatModelChecked: Boolean(chatModel),
      chatModelAvailable,
      embedModelChecked: Boolean(embedModel),
      embedDimension,
      warnings,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      provider,
      models,
      chatModelChecked: Boolean(chatModel),
      chatModelAvailable,
      embedModelChecked: Boolean(embedModel),
      embedDimension,
      warnings,
      error: `无法连接 ${baseUrl}：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

