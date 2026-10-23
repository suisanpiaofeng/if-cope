"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** 最左功能竖栏：可收起为窄图标栏（参考 OpenFic） */
export default function Sidebar({ configured }: { configured: boolean | null }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-neutral-300 bg-white transition-[width] duration-150 ${
        collapsed ? "w-[56px]" : "w-[120px]"
      }`}
    >
      {collapsed ? (
        <div className="flex justify-center pb-3 pt-4">
          <CollapseBtn collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </div>
      ) : (
        <div className="flex items-start justify-between px-4 pb-5 pt-4">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-semibold tracking-tight">IF.Cope</span>
            </div>
            <span className="mt-1 inline-block rounded border border-neutral-200 px-1 py-px text-[10px] text-neutral-400">Demo</span>
          </div>
          <CollapseBtn collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </div>
      )}

      <nav className={`flex-1 space-y-1 ${collapsed ? "px-2" : "px-2.5"}`}>
        <NavItem collapsed={collapsed} icon="grid" label="工作台" href="/" />
        <NavItem collapsed={collapsed} icon="tools" label="工具库" href="/tools" />
        <NavItem collapsed={collapsed} icon="settings" label="设置" href="/settings" />
      </nav>

      <div className={`border-t border-neutral-100 py-3 ${collapsed ? "flex justify-center" : "px-3.5"}`}>
        {configured !== null && (
          <span title={configured ? "模型已配置" : "演示模式"}
            className={`flex items-center gap-1.5 text-[11px] leading-4 ${
              configured ? "text-emerald-700" : "text-amber-700"
            }`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${configured ? "bg-emerald-500" : "bg-amber-500"}`} />
            {!collapsed && (configured ? "模型已配置" : "演示模式")}
          </span>
        )}
      </div>
    </aside>
  );
}

function CollapseBtn({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} title={collapsed ? "展开侧栏" : "收起侧栏"} aria-label="收起/展开侧栏"
      className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6" />
        <path d="M6.4 2.5v11" />
        <rect x="1.8" y="2.5" width="4.6" height="11" rx="1.6" fill="currentColor" opacity="0.18" stroke="none" />
      </svg>
    </button>
  );
}

function NavItem({ href, label, icon, active, collapsed }: {
  href: string; label: string; icon: "grid" | "settings" | "tools"; active?: boolean; collapsed?: boolean;
}) {
  const pathname = usePathname();
  const on = active ?? pathname === href;
  return (
    <Link
      href={href}
      title={label}
      className={`flex items-center rounded-lg text-[13px] transition-colors ${
        collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-2"
      } ${
        on ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      }`}
    >
      {icon === "grid" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      ) : icon === "tools" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <path d="M9.8 2.2a3.4 3.4 0 0 0-3.3 4.3L2.3 10.7a1.3 1.3 0 0 0 1.8 1.8l4.2-4.2a3.4 3.4 0 0 0 4.3-3.3l-1.9 1.9-1.8-.4-.4-1.8 1.9-1.9a3.5 3.5 0 0 0-.6-.6Z" />
          <circle cx="3.4" cy="12.6" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
        </svg>
      )}
      {!collapsed && label}
    </Link>
  );
}
