/** 原始文件预览的类型判断（前后端共用的纯函数模块）
 *  第一批：Markdown / 图片 / 代码 / 纯文本；PDF、DOCX 留到第二批。 */

export type FilePreviewKind = "markdown" | "image" | "code" | "text" | "pdf" | "docx" | "site" | "sheet";

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export const CODE_EXTS = new Set([
  "py", "js", "jsx", "ts", "tsx", "json", "html", "css", "scss",
  "sql", "sh", "bash", "java", "go", "rs", "c", "cpp", "h", "hpp",
  "cs", "php", "swift", "kt", "dart", "vue", "yaml", "yml", "toml", "xml",
]);

const TEXT_EXTS = new Set(["txt", "log"]);

/** 表格类（Univer 编辑器接管，P5）：csv 文本解析；xlsx 二进制 SheetJS 解析 */
export const SHEET_EXTS = new Set(["csv", "xlsx"]);

/** 可编辑的文本类扩展名：markdown / 代码 / 纯文本（图片、PDF 只读） */
export const EDITABLE_EXTS = new Set(["md", "markdown", ...TEXT_EXTS, ...CODE_EXTS]);

export function isEditableExt(ext: string): boolean {
  return EDITABLE_EXTS.has(ext.toLowerCase().trim());
}

/** 返回预览方式；null 表示该扩展名没有原始文件预览（走解析文本回退） */
export function filePreviewKind(ext: string): FilePreviewKind | null {
  const e = ext.toLowerCase().trim();
  if (!e) return null;
  if (e === "md" || e === "markdown") return "markdown";
  if (IMAGE_EXTS.has(e)) return "image";
  if (CODE_EXTS.has(e)) return "code";
  if (e === "pdf") return "pdf";
  if (e === "docx") return "docx";
  if (SHEET_EXTS.has(e)) return "sheet";
  if (TEXT_EXTS.has(e)) return "text";
  return null;
}
