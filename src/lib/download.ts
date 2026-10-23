/** 产物下载：拉取内容 → Blob → 保存（.md；qa-canvas 存 .json；translation 重组为对照 .md） */
export async function downloadArtifact(id: number, title: string): Promise<void> {
  const res = await fetch(`/api/artifacts/${id}`);
  if (!res.ok) throw new Error(`获取产物失败（HTTP ${res.status}）`);
  const d = (await res.json()) as { content?: string; type?: string };
  const content = d.content ?? "";
  let body = content;
  let ext = "md";
  let mime = "text/markdown;charset=utf-8";
  if (d.type === "qa-canvas") {
    ext = "json";
    mime = "application/json;charset=utf-8";
  } else if (d.type === "translation") {
    // 把对照 JSON 重组成可读 markdown 再下载
    try {
      const doc = JSON.parse(content) as {
        sourceTitle?: string;
        model?: string;
        segments?: { page: number | null; heading?: string; src: string; trg: string }[];
      };
      const parts = [`# ${doc.sourceTitle ?? ""} · 中文翻译`, "", `> 模型 ${doc.model ?? "-"}`, ""];
      for (const s of doc.segments ?? []) {
        if (s.page != null) parts.push(`---`, `**第 ${s.page} 页${s.heading ? ` · ${s.heading}` : ""}**`, "");
        parts.push("**原文**", "", s.src, "", "**译文**", "", s.trg, "");
      }
      body = parts.join("\n");
    } catch {
      /* 解析失败下载原始内容 */
    }
  }
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "产物").replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
