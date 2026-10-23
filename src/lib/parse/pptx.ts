import type { ParseResult } from "./index";

/** PPTX 逐页（逐张幻灯片）提取文本，幻灯片号即页码 */
export async function parsePptx(buffer: Buffer): Promise<ParseResult> {
  // jszip 仅解析 PPTX 时才需要，懒加载保持主进程轻量
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });

  const pages: ParseResult["pages"] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("string");
    // <a:t>文本</a:t> 是 PPTX 里所有可见文本的落点
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
    const text = texts.join("\n").trim();
    if (text) pages.push({ page: i + 1, text });
  }
  return { pages };
}
