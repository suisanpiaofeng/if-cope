/** 产物下载：拉取完整内容 → Blob → 浏览器保存（.md / qa-canvas 存 .json） */
export async function downloadArtifact(id: number, title: string): Promise<void> {
  const res = await fetch(`/api/artifacts/${id}`);
  if (!res.ok) throw new Error(`获取产物失败（HTTP ${res.status}）`);
  const d = (await res.json()) as { content?: string; type?: string };
  const content = d.content ?? "";
  const isJson = d.type === "qa-canvas";
  const blob = new Blob([content], {
    type: isJson ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "产物").replace(/[\\/:*?"<>|]/g, "_")}.${isJson ? "json" : "md"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
