"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import SettingsDrawer from "./SettingsDrawer";

/** 最左功能竖栏：可收起为窄图标栏（参考 OpenFic） */
export default function Sidebar({ configured }: { configured: boolean | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-neutral-300 bg-white transition-[width] duration-150 ${
        collapsed ? "w-[56px]" : "w-[120px]"
      }`}
    >
      {/* 头部：缩放按钮固定在左侧原地，收起时不位移；无 Demo 标 */}
      <div className="flex items-center gap-1.5 px-2.5 pb-5 pt-4">
        <CollapseBtn collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight">IF.Cope</span>
        )}
      </div>

      <nav className={`flex-1 space-y-1 ${collapsed ? "px-2" : "px-2.5"}`}>
        <NavItem collapsed={collapsed} icon="grid" label="工作台" href="/" />
        <NavItem collapsed={collapsed} icon="translate" label="文献翻译" href="/translate" />
        <NavItem collapsed={collapsed} icon="solve" label="解题答疑" href="/solve" />
        <NavItem collapsed={collapsed} icon="tools" label="工具库" href="/tools" />
        <NavItem collapsed={collapsed} icon="classroom" label="课堂" href="/classroom" />
        <SettingsItem collapsed={collapsed} onClick={() => setSettingsOpen(true)} />
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

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
  href: string; label: string; icon: "grid" | "settings" | "tools" | "solve" | "translate" | "classroom"; active?: boolean; collapsed?: boolean;
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
      ) : icon === "translate" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <path d="M1.5 3.5h6M4.5 3.5V2M6.5 3.5c-.5 2-1.8 3.6-3.5 4.4M3 6c.8 1.4 2.2 2.4 4 2.7" />
          <path d="M8.5 14 12 6.5 15.5 14M9.7 11.5h4.6" />
        </svg>
      ) : icon === "solve" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.4 10.4 14 14" strokeLinecap="round" />
          <path d="M5.4 7.6c0-1 .8-1.6 1.7-1.6.8 0 1.5.5 1.5 1.3 0 .9-.7 1.1-1.2 1.4-.3.2-.4.4-.4.8" strokeLinecap="round" />
          <circle cx="7" cy="10.9" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      ) : icon === "tools" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <path d="M9.8 2.2a3.4 3.4 0 0 0-3.3 4.3L2.3 10.7a1.3 1.3 0 0 0 1.8 1.8l4.2-4.2a3.4 3.4 0 0 0 4.3-3.3l-1.9 1.9-1.8-.4-.4-1.8 1.9-1.9a3.5 3.5 0 0 0-.6-.6Z" />
          <circle cx="3.4" cy="12.6" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      ) : icon === "classroom" ? (
        <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <rect x="1.5" y="3" width="13" height="8.5" rx="1.2" />
          <path d="M5.5 13.8h5M8 11.5v2.3" strokeLinecap="round" />
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

/** 设置项：点击打开右侧抽屉（非路由跳转） */
function SettingsItem({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="设置"
      className={`flex w-full items-center rounded-lg text-[13px] text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 ${
        collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-2"
      }`}
    >
      <svg className="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
      </svg>
      {!collapsed && "设置"}
    </button>
  );
}
