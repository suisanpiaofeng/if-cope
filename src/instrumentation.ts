/** Next 15 instrumentation：随应用启动本机反代（dev/prod 均生效） */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRevProxy } = await import("./lib/classroom/revProxy");
    startRevProxy();
  }
}
