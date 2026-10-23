/**
 * 联网搜索（轻量抓取，免 API Key）：资料检索不到时给回答补时效性参考。
 * 只取标题/链接/摘要三要素；失败静默返回空（不影响回答链路）。
 * 后续可换官方搜索 API（Tavily/Bing/博查）：实现同名函数即可。
 */

export type WebHit = { title: string; url: string; snippet: string };

/** 提炼搜索核心词：去掉疑问/客套/时效虚词，避免整句搜出风马牛不相及的结果 */
function coreQuery(raw: string): string {
  const cleaned = raw
    .replace(/[？?。，,！!、；;：:（）()\[\]]+/g, " ")
    .replace(
      /(请问|我想知道|帮我[查搜一下]*|你知道|能不能[告诉说说]*|麻烦[查搜一下]*|有什么|有哪些|哪些|是什么|怎么样|如何|怎么|为什么|能不能|可以吗|吗|呢|吧|啊|一下|最近|今天|今日|现在|目前|当前|最新|重要|相关|领域|的)/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.replace(/\s/g, "").length >= 2 ? cleaned : raw).slice(0, 40);
}

export async function webSearch(query: string, topK = 5): Promise<WebHit[]> {
  const q = coreQuery(query.trim()).slice(0, 80);
  if (!q) return [];
  try {
    const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&ensearch=0`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const hits: WebHit[] = [];
    for (const block of html.split('<li class="b_algo"').slice(1, topK + 2)) {
      const title = block
        .match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1]
        ?.replace(/<[^>]+>/g, "")
        .trim();
      const url = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/)?.[1];
      const snippet = block
        .match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]
        ?.replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (title && url && url.startsWith("http")) {
        hits.push({ title: title.slice(0, 60), url, snippet: (snippet ?? "").slice(0, 200) });
        if (hits.length >= topK) break;
      }
    }
    return hits;
  } catch {
    return []; // 断网/被拦/超时一律静默降级
  }
}

export function webHitsToContext(hits: WebHit[]): string {
  return [
    "网络检索结果（可能有时效性；回答时可直接给出链接，不要用 [n] 标注网络来源）：",
    ...hits.map((h, i) => `${i + 1}. 《${h.title}》 ${h.url}\n   ${h.snippet}`),
  ].join("\n");
}
