/**
 * Promise 超时包装（计划 Task 2）。纯函数，零运行时依赖。
 * 超时后原 promise 丢弃（其结果/错误忽略），reject Error(message 含"超时")。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
