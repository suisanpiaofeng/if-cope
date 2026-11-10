/**
 * Agent 循环护栏（计划 Task 2）。纯类，零运行时依赖。
 * - 同名同参数累计第 3 次 → 提示"重复调用"，清零该键计数（防刷屏）；
 * - 累计调用超 maxToolCalls → 提示"预算"，清零总数（防刷屏，每 N 次提醒一次）。
 */
export class LoopGuard {
  private readonly maxToolCalls: number;
  private count = 0;
  private readonly streak = new Map<string, number>();

  constructor(maxToolCalls = 16) {
    this.maxToolCalls = maxToolCalls;
  }

  record(name: string, argsJson: string): string | null {
    this.count += 1;
    if (this.count > this.maxToolCalls) {
      this.count = 0;
      return "工具调用预算已用尽，请立即收敛并总结";
    }
    const key = `${name}\u0000${argsJson}`;
    const n = (this.streak.get(key) ?? 0) + 1;
    if (n >= 3) {
      this.streak.set(key, 0);
      return `检测到重复调用（${name}），请换策略或停止`;
    }
    this.streak.set(key, n);
    return null;
  }
}
