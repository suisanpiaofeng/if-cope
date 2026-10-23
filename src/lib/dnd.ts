/** 内部拖拽（资源/成果在类目间移动、拖入聊天框）使用的 MIME 类型 */
export const DND_MIME = "application/x-ifcope";

export type DndPayload =
  | { kind: "source"; ids: number[] }
  | { kind: "artifact"; ids: number[] };

export function readDnd(dataTransfer: DataTransfer): DndPayload | null {
  try {
    const raw = dataTransfer.getData(DND_MIME);
    if (!raw) return null;
    const p = JSON.parse(raw) as DndPayload;
    if ((p.kind === "source" || p.kind === "artifact") && Array.isArray(p.ids)) return p;
  } catch { /* 非内部拖拽 */ }
  return null;
}
