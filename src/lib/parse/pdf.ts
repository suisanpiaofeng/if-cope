import type { ParseResult } from "./index";

/** PDF 逐页提取文本，保留页码作为引用锚点 */
export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: ParseResult["pages"] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // 按 y 坐标粗分行，避免整页文字粘连
    let lastY: number | null = null;
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
      if (!item.str) continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        lines.push(line.trim());
        line = "";
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
      if (y !== null) lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) pages.push({ page: i, text });
  }
  return { pages };
}
