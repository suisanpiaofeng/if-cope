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
  // ── 批1：纯 JS 零依赖 ──
  {
    id: "uuid",
    name: "UUID 生成",
    desc: "v4 随机 UUID，批量生成",
    category: "开发",
    keywords: ["uuid", "guid", "随机", "唯一", "标识符", "id"],
    load: () => import("@/components/tools/UuidGenerator"),
  },
  {
    id: "password",
    name: "密码生成",
    desc: "随机密码 + 强度评估",
    category: "安全",
    keywords: ["密码", "password", "随机", "生成", "强度", "passphrase"],
    load: () => import("@/components/tools/PasswordGenerator"),
  },
  {
    id: "random-number",
    name: "随机数",
    desc: "区间随机 / 不重复抽签",
    category: "生活",
    keywords: ["随机数", "随机", "抽签", "random", "掷骰", "开奖"],
    load: () => import("@/components/tools/RandomNumber"),
  },
  {
    id: "base-converter",
    name: "进制转换",
    desc: "2/8/10/16 进制互转",
    category: "编码",
    keywords: ["进制", "二进制", "十六进制", "八进制", "base", "hex", "binary", "转换"],
    load: () => import("@/components/tools/BaseConverter"),
  },
  {
    id: "base32-58",
    name: "Base32/58",
    desc: "Base32 / Base58 编解码",
    category: "编码",
    keywords: ["base32", "base58", "编码", "解码", "比特币", "bitcoin"],
    load: () => import("@/components/tools/Base3258"),
  },
  {
    id: "case-converter",
    name: "大小写转换",
    desc: "camel/snake/kebab 等命名风格",
    category: "文本",
    keywords: ["大小写", "驼峰", "camel", "snake", "kebab", "pascal", "命名", "转换"],
    load: () => import("@/components/tools/CaseConverter"),
  },
  {
    id: "text-diff",
    name: "文本对比",
    desc: "逐行 Diff 高亮增删",
    category: "文本",
    keywords: ["对比", "diff", "差异", "比较", "版本", "改动"],
    load: () => import("@/components/tools/TextDiff"),
  },
  {
    id: "hash",
    name: "Hash / HMAC",
    desc: "SHA-1/256/384/512，支持文件",
    category: "安全",
    keywords: ["hash", "sha", "md5", "摘要", "校验", "hmac", "哈希", "加密"],
    load: () => import("@/components/tools/HashTool"),
  },
  {
    id: "jwt",
    name: "JWT 解码",
    desc: "解析 Header/Payload，本地解码",
    category: "开发",
    keywords: ["jwt", "token", "解码", "header", "payload", "过期"],
    load: () => import("@/components/tools/JwtDecoder"),
  },
  {
    id: "sql-format",
    name: "SQL 格式化",
    desc: "关键字大写 + 换行缩进",
    category: "开发",
    keywords: ["sql", "格式化", "美化", "select", "数据库", "查询"],
    load: () => import("@/components/tools/SqlFormatter"),
  },
  {
    id: "html-entities",
    name: "HTML 实体",
    desc: "特殊字符转义 / 还原",
    category: "编码",
    keywords: ["html", "实体", "转义", "entities", "escape", "解码"],
    load: () => import("@/components/tools/HtmlEntities"),
  },
  {
    id: "url-parser",
    name: "URL 解析",
    desc: "拆解并编辑 URL 与参数",
    category: "开发",
    keywords: ["url", "解析", "参数", "query", "链接", "地址", "构造"],
    load: () => import("@/components/tools/UrlParser"),
  },
  {
    id: "unit-converter",
    name: "单位换算",
    desc: "长度/重量/温度/面积等",
    category: "生活",
    keywords: ["单位", "换算", "长度", "重量", "温度", "面积", "体积", "速度"],
    load: () => import("@/components/tools/UnitConverter"),
  },
  {
    id: "percentage",
    name: "百分比计算",
    desc: "占比/变化率/折扣多场景",
    category: "生活",
    keywords: ["百分比", "占比", "折扣", "变化率", "percent", "计算", "涨幅"],
    load: () => import("@/components/tools/PercentageCalculator"),
  },
  {
    id: "timezone",
    name: "时区转换",
    desc: "北京 ↔ 世界主要城市",
    category: "时间",
    keywords: ["时区", "timezone", "世界时间", "转换", "utc", "纽约", "伦敦"],
    load: () => import("@/components/tools/TimezoneConverter"),
  },
  {
    id: "cron",
    name: "Cron 生成",
    desc: "点选式生成 + 运行时间预览",
    category: "开发",
    keywords: ["cron", "定时", "表达式", "计划任务", "crontab", "调度"],
    load: () => import("@/components/tools/CronGenerator"),
  },
  {
    id: "lorem",
    name: "假文生成",
    desc: "中英文占位文，可控段数字数",
    category: "文本",
    keywords: ["假文", "占位", "lorem", "排版", "测试", "文本", "填充"],
    load: () => import("@/components/tools/LoremIpsum"),
  },
  {
    id: "emoji",
    name: "Emoji 选择器",
    desc: "分类搜索，点击复制",
    category: "文本",
    keywords: ["emoji", "表情", "符号", "颜文字", "选择", "复制"],
    load: () => import("@/components/tools/EmojiPicker"),
  },
  {
    id: "timer",
    name: "计时器",
    desc: "倒计时 + 秒表",
    category: "时间",
    keywords: ["计时", "秒表", "倒计时", "timer", "stopwatch", "闹钟"],
    load: () => import("@/components/tools/TimerTool"),
  },
  {
    id: "base64-file",
    name: "Base64 文件",
    desc: "文件 ↔ Base64 互转",
    category: "编码",
    keywords: ["base64", "文件", "编码", "解码", "转码", "二进制"],
    load: () => import("@/components/tools/Base64File"),
  },
  // ── 批2：轻依赖（复用 pdf-lib / pdfjs / js-yaml / smol-toml） ──
  {
    id: "json-yaml",
    name: "JSON↔YAML",
    desc: "JSON 与 YAML 实时互转",
    category: "数据",
    keywords: ["yaml", "json", "转换", "互转", "配置", "yml"],
    load: () => import("@/components/tools/JsonYaml"),
  },
  {
    id: "json-toml",
    name: "JSON↔TOML",
    desc: "JSON 与 TOML 实时互转",
    category: "数据",
    keywords: ["toml", "json", "转换", "配置", "cargo"],
    load: () => import("@/components/tools/JsonToml"),
  },
  {
    id: "json-csv",
    name: "JSON↔CSV",
    desc: "对象数组与 CSV 互转",
    category: "数据",
    keywords: ["csv", "json", "转换", "表格", "excel", "导出"],
    load: () => import("@/components/tools/JsonCsv"),
  },
  {
    id: "json-diff",
    name: "JSON 对比",
    desc: "结构化 Diff 高亮差异",
    category: "数据",
    keywords: ["json", "对比", "diff", "差异", "比较"],
    load: () => import("@/components/tools/JsonDiff"),
  },
  {
    id: "json-to-code",
    name: "JSON 转代码",
    desc: "TS/Go/Python/Java/C#/SQL",
    category: "数据",
    keywords: ["json", "代码", "typescript", "struct", "实体类", "pojo", "建表", "转换"],
    load: () => import("@/components/tools/JsonToCode"),
  },
  {
    id: "csv-viewer",
    name: "CSV 预览",
    desc: "表格可视化 + 去重清洗",
    category: "数据",
    keywords: ["csv", "预览", "表格", "清洗", "去重", "excel", "tsv"],
    load: () => import("@/components/tools/CsvViewer"),
  },
  {
    id: "pdf-split",
    name: "PDF 拆分",
    desc: "按范围提取若干页",
    category: "PDF",
    keywords: ["pdf", "拆分", "提取", "分页", "页码", "split", "抽取"],
    load: () => import("@/components/tools/PdfSplit"),
  },
  {
    id: "pdf-rotate",
    name: "PDF 旋转",
    desc: "整体或按页旋转方向",
    category: "PDF",
    keywords: ["pdf", "旋转", "rotate", "方向", "翻转"],
    load: () => import("@/components/tools/PdfRotate"),
  },
  {
    id: "pdf-to-images",
    name: "PDF 转图片",
    desc: "逐页渲染 PNG/JPEG",
    category: "PDF",
    keywords: ["pdf", "转图片", "截图", "png", "jpeg", "导出", "渲染"],
    load: () => import("@/components/tools/PdfToImages"),
  },
  {
    id: "image-to-pdf",
    name: "图片转 PDF",
    desc: "多图合成 PDF，可选页型",
    category: "PDF",
    keywords: ["图片", "pdf", "合成", "扫描", "拼接", "导出"],
    load: () => import("@/components/tools/ImageToPdf"),
  },
  {
    id: "image-resize",
    name: "图片改尺寸",
    desc: "像素/百分比缩放",
    category: "图片",
    keywords: ["图片", "尺寸", "缩放", "resize", "压缩", "像素"],
    load: () => import("@/components/tools/ImageResize"),
  },
  {
    id: "image-crop",
    name: "图片裁剪",
    desc: "拖拽框选裁剪区域",
    category: "图片",
    keywords: ["图片", "裁剪", "crop", "剪切", "截取"],
    load: () => import("@/components/tools/ImageCrop"),
  },
  {
    id: "color-picker",
    name: "取色器",
    desc: "图片取色 + 主要配色",
    category: "图片",
    keywords: ["取色", "颜色", "色值", "hex", "配色", "color", "吸管"],
    load: () => import("@/components/tools/ColorPicker"),
  },
  {
    id: "markdown-editor",
    name: "Markdown 编辑",
    desc: "左编辑右预览，自动存草稿",
    category: "文本",
    keywords: ["markdown", "编辑", "预览", "md", "写作", "笔记"],
    load: () => import("@/components/tools/MarkdownEditor"),
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
