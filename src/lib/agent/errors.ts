/**
 * 错误分类与友好提示（harness P1 §7.4，纯函数）。
 * 五类：network/timeout/validation/denied/unknown。
 * 统一模板「[类别] 原信息 + 建议」：喂给模型的回喂文本与 UI ErrorBanner 共用一套语义。
 */

export type ErrorKind = "network" | "timeout" | "validation" | "denied" | "unknown";

const KIND_LABELS: Record<ErrorKind, string> = {
  network: "网络错误",
  timeout: "执行超时",
  validation: "参数有误",
  denied: "已拦截",
  unknown: "执行失败",
};

const SUGGESTIONS: Record<ErrorKind, string> = {
  network: "请检查网络连接后重试",
  timeout: "请缩小范围或调大 timeout_ms 后重试",
  validation: "请按提示修正参数后重试",
  denied: "请换一种安全方式，或先询问学生的意见",
  unknown: "请重试；若持续失败，请把错误信息反馈给学生",
};

/** 错误分类（关键词表；拒绝类优先判定，防“拒绝”被误归校验） */
export function classifyError(msg: string): ErrorKind {
  const m = String(msg ?? "");
  if (/安全策略|学生未确认|拒绝|已禁用|禁用/.test(m)) return "denied";
  if (/超时|timeout|timed out|ETIMEDOUT/i.test(m)) return "timeout";
  if (/fetch failed|ECONN|ENOTFOUND|socket|网络/i.test(m)) return "network";
  if (/路径超出工作区|不能为空|非法|不存在|必须是|目标是|已被修改|已截断|超过|上限/.test(m)) return "validation";
  return "unknown";
}

/** 友好错误：[类别] 原信息（建议：…） */
export function friendlyError(kind: ErrorKind, msg: string): string {
  return `[${KIND_LABELS[kind]}] ${String(msg ?? "").trim()}（建议：${SUGGESTIONS[kind]}）`;
}

/** 剥 ANSI 转义（命令输出防 UI 污染） */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}
