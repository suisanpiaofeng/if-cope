import type { ComponentType } from "react";

/**
 * 工具库注册表（学习 it-tools 的 defineTool 模式）。
 * 纯元数据 + 懒加载，客户端可安全 import（不含任何服务端依赖）。
 *
 * 新增工具 = 写一个组件 + 在下面 TOOLS 里加一行。
 * - 组件放 `src/components/tools/<Name>.tsx`（纯逻辑多时可拆 `<name>/index.tsx` + `<name>/<name>.service.ts`）
 * - load 必须是 `() => import(...)` 懒加载：每个工具（含其依赖）只在被选中时才进内存，
 *   切走即卸载。禁止在顶部静态 import 工具组件（会破坏内存纪律）。
 */

export type ToolCategory =
  | "文本"
  | "编码"
  | "开发"
  | "数据"
  | "图片"
  | "PDF"
  | "时间"
  | "生活"
  | "安全";

/** 侧栏分类展示顺序 */
export const CATEGORY_ORDER: ToolCategory[] = [
  "文本",
  "编码",
  "开发",
  "数据",
  "图片",
  "PDF",
  "时间",
  "生活",
  "安全",
];

export type ToolDef = {
  /** URL 深链用的唯一 slug，如 "text-stats" */
  id: string;
  name: string;
  desc: string;
  category: ToolCategory;
  /** 搜索关键词（中英混排，覆盖常见叫法） */
  keywords: string[];
  /** 懒加载：只在选中该工具时才 import */
  load: () => Promise<{ default: ComponentType }>;
};

export const TOOLS: ToolDef[] = [
  {
    id: "text-stats",
    name: "字数统计",
    desc: "字符 / 词数 / 行数 / 体积一键统计",
    category: "文本",
    keywords: ["字数", "统计", "字符", "词数", "word count", "wc", "字符数"],
    load: () => import("@/components/tools/TextStats"),
  },
  {
    id: "json",
    name: "JSON 格式化",
    desc: "格式化、压缩、校验 JSON",
    category: "开发",
    keywords: ["json", "格式化", "压缩", "校验", "format", "minify", "pretty"],
    load: () => import("@/components/tools/JsonFormatter"),
  },
  {
    id: "regex",
    name: "正则测试",
    desc: "实时匹配高亮 + 常用正则模板",
    category: "开发",
    keywords: ["正则", "regex", "regexp", "匹配", "regular expression"],
    load: () => import("@/components/tools/RegexTester"),
  },
  {
    id: "codec",
    name: "编解码",
    desc: "Base64 / URL 编码与解码",
    category: "编码",
    keywords: ["base64", "url", "编码", "解码", "encode", "decode", "uri"],
    load: () => import("@/components/tools/CodecTools"),
  },
  {
    id: "image-compress",
    name: "图片压缩",
    desc: "压缩 / 转格式，对比体积后下载",
    category: "图片",
    keywords: ["图片", "压缩", "转格式", "image", "compress", "jpg", "png", "webp"],
    load: () => import("@/components/tools/ImageCompress"),
  },
  {
    id: "pdf-merge",
    name: "PDF 合并",
    desc: "多个 PDF 按顺序合并为一个",
    category: "PDF",
    keywords: ["pdf", "合并", "merge", "combine"],
    load: () => import("@/components/tools/PdfMerge"),
  },
  {
    id: "timestamp",
    name: "时间戳转换",
    desc: "Unix 时间戳 ↔ 可读时间",
    category: "时间",
    keywords: ["时间戳", "timestamp", "unix", "日期", "date", "时间"],
    load: () => import("@/components/tools/Timestamp"),
  },
  {
    id: "qrcode",
    name: "二维码生成",
    desc: "文本 / 链接生成二维码图片",
    category: "生活",
    keywords: ["二维码", "qrcode", "qr", "条码", "barcode", "生成"],
    load: () => import("@/components/tools/QrCode"),
  },
];

/** 按分类分组（保持 CATEGORY_ORDER 顺序，跳过空分类） */
export function groupByCategory(tools: ToolDef[]): [ToolCategory, ToolDef[]][] {
  const map = new Map<ToolCategory, ToolDef[]>();
  for (const t of tools) {
    const arr = map.get(t.category) ?? [];
    arr.push(t);
    map.set(t.category, arr);
  }
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!]);
}

/** 名称 + 关键词匹配（不区分大小写） */
export function matchTool(tool: ToolDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (tool.name.toLowerCase().includes(q) || tool.desc.toLowerCase().includes(q)) return true;
  return tool.keywords.some((k) => k.toLowerCase().includes(q));
}
