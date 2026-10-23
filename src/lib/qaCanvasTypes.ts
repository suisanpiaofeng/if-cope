/**
 * 解答图（qa-canvas，历史产物）：类型定义（客户端安全，零服务端依赖）。
 * 曾经的生成层已废弃（解题答疑已升级为知识地图），保留类型仅供历史产物渲染；
 * 纯函数/校验已随生成层一并移除，避免死代码。
 */

export type QaCite = { sourceId: number; page: number | null; quote: string };

export type QaNodeKind = "question" | "approach" | "step" | "knowledge" | "pitfall" | "answer";

export type QaNode = {
  id: string;
  parent: string | null;
  kind: QaNodeKind;
  label: string;
  detail: string;
  cites?: QaCite[];
};

export type QaCanvasData = { title: string; nodes: QaNode[] };
