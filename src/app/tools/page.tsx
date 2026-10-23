"use client";

/**
 * 工具库：纯前端小工具集合（选品参考 ToolKnit，只收学生高频 + 无需服务端引擎的）。
 * 每个工具 = 一个独立组件，注册进 TOOLS 即出现在目录里。
 */
import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import TextStats from "@/components/tools/TextStats";
import JsonFormatter from "@/components/tools/JsonFormatter";
import RegexTester from "@/components/tools/RegexTester";
import CodecTools from "@/components/tools/CodecTools";
import ImageCompress from "@/components/tools/ImageCompress";
import QrCode from "@/components/tools/QrCode";
import PdfMerge from "@/components/tools/PdfMerge";
import Timestamp from "@/components/tools/Timestamp";

type Tool = {
  id: string;
  name: string;
  desc: string;
  category: string;
  component: React.ComponentType;
};

const TOOLS: Tool[] = [
  { id: "text-stats", name: "字数统计", desc: "字符 / 词数 / 行数 / 体积一键统计", category: "文本", component: TextStats },
  { id: "json", name: "JSON 格式化", desc: "格式化、压缩、校验 JSON", category: "文本", component: JsonFormatter },
  { id: "regex", name: "正则测试", desc: "实时匹配高亮 + 常用正则模板", category: "文本", component: RegexTester },
  { id: "codec", name: "编解码", desc: "Base64 / URL 编码与解码", category: "开发", component: CodecTools },
  { id: "image-compress", name: "图片压缩", desc: "压缩 / 转格式，对比体积后下载", category: "图片", component: ImageCompress },
  { id: "pdf-merge", name: "PDF 合并", desc: "多个 PDF 按顺序合并为一个", category: "PDF", component: PdfMerge },
  { id: "timestamp", name: "时间戳转换", desc: "Unix 时间戳 ↔ 可读时间", category: "生活", component: Timestamp },
  { id: "qrcode", name: "二维码生成", desc: "文本 / 链接生成二维码图片", category: "生活", component: QrCode },
];

const CATEGORIES = [...new Set(TOOLS.map((t) => t.category))];

export default function ToolsPage() {
  const [activeId, setActiveId] = useState(TOOLS[0].id);
  const active = TOOLS.find((t) => t.id === activeId)!;
  const ActiveComp = active.component;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar configured={null} />

      <div className="flex w-[240px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-[15px] font-semibold tracking-tight">工具库</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">纯本地运行 · 文件不上传</div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="mb-1">
              <div className="px-4 pb-1 pt-2 text-[10px] uppercase tracking-wider text-neutral-400">{cat}</div>
              {TOOLS.filter((t) => t.category === cat).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={`block w-full px-4 py-1.5 text-left text-[13px] transition-colors ${
                    t.id === activeId
                      ? "border-l-2 border-neutral-900 bg-neutral-100 font-medium text-neutral-900"
                      : "border-l-2 border-transparent text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-neutral-200 px-6 py-3">
          <div className="text-[15px] font-semibold">{active.name}</div>
          <div className="mt-0.5 text-[12px] text-neutral-500">{active.desc}</div>
        </div>
        <div className="flex-1 px-6 py-5">
          <ActiveComp />
        </div>
      </main>
    </div>
  );
}
