import { Suspense } from "react";
import ToolsClient from "@/components/tools/ToolsClient";

/** 工具库（server 壳：useSearchParams 需 Suspense 边界，主体在 ToolsClient） */
export default function ToolsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white text-xs text-neutral-400">
          加载工具库…
        </div>
      }
    >
      <ToolsClient />
    </Suspense>
  );
}
