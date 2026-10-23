/**
 * 翻译上游解析（服务端）：
 * translate* 逐项回退对话模型配置。文献翻译现仅保留 PDF 保真通道（pdf2zh），
 * 本文件只提供上游解析给 pdfTranslate 使用；旧的分段文本翻译引擎已移除
 * （历史文本翻译产物仍可在工作台/翻译页查看与下载）。
 */
import { getSettings } from "./db";

/** 解析翻译上游：translate* 逐项回退对话模型配置 */
export function translateUpstream() {
  const s = getSettings();
  return {
    baseUrl: s.translateBaseUrl || s.baseUrl,
    apiKey: s.translateApiKey || s.apiKey,
    model: s.translateModel || s.chatModel,
    configured: Boolean((s.translateBaseUrl || s.baseUrl) && (s.translateApiKey || s.apiKey) && (s.translateModel || s.chatModel)),
  };
}
