/** 全应用共用的数据形状 */

/** 资源（学生上传的资料 / 网页 / 粘贴文本） */
export type Source = {
  id: number;
  title: string;
  ext: string;
  size: number;
  source_type: string;   // file | link
  url: string | null;
  type: string;          // 课件 | 真题 | 笔记 | 录音 | 网页 | 翻译 | 其他
  /** 译文专用：原文资源 id（type=翻译 时指向被翻译的那份；供历史打开原译对照） */
  origin_id?: number | null;
  category_id: number | null;
  status: string;        // processing | ready | failed
  note: string | null;
  page_count: number;
  chunk_count: number;
  created_at: number;
};

/** 文献翻译：段落（按已解析块，带页码）与翻译产物 */
export type TranslateSegment = { page: number | null; heading: string; src: string; trg: string };
export type TranslationDoc = {
  sourceId: number;
  sourceTitle: string;
  model: string;
  segments: TranslateSegment[];
  truncated?: boolean;
  translatedAt: number;
};

/** PDF 保真翻译（pdf2zh）：原版排版保留的双语/译文 PDF */
export type PdfTranslationDoc = {
  kind: "pdf";
  sourceId: number;
  sourceTitle: string;
  /** 旧产物：双语对照版 PDF（相对 data/translations 的路径；新版不再产出） */
  dualPdf?: string;
  /** 旧产物：纯译文版 PDF（相对 data/translations 的路径） */
  monoPdf?: string;
  /** 新产物：译文 PDF 已入库为资源（可通过 /api/preview/<id> 预览/下载） */
  translatedSourceId?: number;
  model: string;
  engine: "pdf2zh";
  translatedAt: number;
};

export type AnyTranslationDoc = TranslationDoc | PdfTranslationDoc;
export function isPdfDoc(d: AnyTranslationDoc | null | undefined): d is PdfTranslationDoc {
  return !!d && (d as PdfTranslationDoc).kind === "pdf";
}
