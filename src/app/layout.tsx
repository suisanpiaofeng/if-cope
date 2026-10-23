import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IF.Cope — 本地 Demo",
  description: "课程资料工作台：收进来、问得出、能操作。模型来源可配置（词来 Key / OpenAI 兼容）。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-neutral-900">{children}</body>
    </html>
  );
}
