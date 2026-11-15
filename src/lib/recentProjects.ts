/**
 * 最近项目槽位（OpenFic 对齐，定稿 §3.4）：
 * localStorage 槽位（上限 6）；×=移出槽位（不删项目）；进入项目自动入槽（置顶去重）。
 */

export type RecentProject = { id: number; title: string; dir: string };

const KEY = "ifcope.recentProjects";
const MAX = 6;

function read(): RecentProject[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentProject[];
    return Array.isArray(arr) ? arr.filter((p) => typeof p?.id === "number") : [];
  } catch {
    return [];
  }
}

function write(list: RecentProject[]): void {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  window.dispatchEvent(new Event("ifcope.recentProjects"));
}

export function listRecent(): RecentProject[] {
  return read();
}

/** 进入项目 → 置顶去重入槽 */
export function pushRecent(p: RecentProject): void {
  write([p, ...read().filter((x) => x.id !== p.id)]);
}

/** 移出槽位（不删项目） */
export function removeRecent(id: number): void {
  write(read().filter((x) => x.id !== id));
}

export function subscribeRecent(cb: () => void): () => void {
  window.addEventListener("ifcope.recentProjects", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("ifcope.recentProjects", cb);
    window.removeEventListener("storage", cb);
  };
}

/** 彩色首字母瓦片配色（按 id 稳定散列；字面量类名供 Tailwind 编译） */
const TILE_STYLES = [
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];

export function projectTileClasses(id: number): string {
  return TILE_STYLES[Math.abs(id) % TILE_STYLES.length];
}

export function projectInitial(title: string): string {
  return (title ?? "").trim().slice(0, 1).toUpperCase() || "项";
}
