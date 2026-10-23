import type { ParseResult } from "./index";

/** Word（.docx）提取：mammoth 出整篇文本，无页概念 */
export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { pages: [{ page: null, text: result.value }] };
}
