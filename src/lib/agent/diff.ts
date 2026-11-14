/**
 * 行级 diff（harness P1 §7.1，纯函数）。
 * LCS 行对比；前后公共段裁剪降成本；乘积超限降级为整块替换；输入超长截断。
 * 供写工具确认卡（服务端 args）与编辑器对比视图（客户端草稿）共用。
 */

export type DiffLine = { type: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

export const DIFF_MAX_LINES = 5000;
const DP_MAX_CELLS = 25_000_000;

function toLines(text: string): { lines: string[]; truncated: boolean } {
  let lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const truncated = lines.length > DIFF_MAX_LINES;
  if (truncated) lines = lines.slice(0, DIFF_MAX_LINES);
  return { lines, truncated };
}

/** 行级 LCS diff；\r\n 归一化；两侧超 5000 行截断并加尾注 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a0 = toLines(oldText);
  const b0 = toLines(newText);
  const a = a0.lines;
  const b = b0.lines;
  const out: DiffLine[] = [];

  // 前后公共段裁剪
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  for (let i = 0; i < start; i++) out.push({ type: "same", text: a[i], oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > DP_MAX_CELLS) {
    // 降级：整块替换（防 LCS DP 卡死）
    midA.forEach((t, i) => out.push({ type: "del", text: t, oldNo: start + i + 1 }));
    midB.forEach((t, i) => out.push({ type: "add", text: t, newNo: start + i + 1 }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: "same", text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ type: "del", text: midA[i], oldNo: start + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: midB[j], newNo: start + j + 1 });
        j++;
      }
    }
    while (i < n) {
      out.push({ type: "del", text: midA[i], oldNo: start + i + 1 });
      i++;
    }
    while (j < m) {
      out.push({ type: "add", text: midB[j], newNo: start + j + 1 });
      j++;
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    out.push({ type: "same", text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  if (a0.truncated || b0.truncated) out.push({ type: "same", text: "……（diff 输入已截断）" });
  return out;
}

/** 统一格式：`+ 新增` / `- 删除` / `  相同`；超 maxLines 尾注截断 */
export function formatDiff(lines: DiffLine[], maxLines: number = 120): string {
  const shown = lines.slice(0, maxLines);
  const out = shown.map((l) => `${l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}${l.text}`);
  if (lines.length > maxLines) out.push(`……（diff 已截断，共 ${lines.length} 行）`);
  return out.join("\n");
}
