/**
 * 重试助手（harness P2 §9.1，纯函数）。
 * retry=true 时失败再试一次（幂等工具安全：write_file 同参重写、只读查询）。
 */

export async function attemptWithRetry<T>(fn: () => Promise<T>, retry: boolean): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!retry) throw e;
    return await fn();
  }
}
