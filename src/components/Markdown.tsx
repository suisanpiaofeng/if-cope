"use client";

/** 共享 Markdown 渲染器（预览区 / 知识地图卡片共用）：标题/列表/表格/引用/代码高亮 */
import React from "react";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown mx-auto max-w-[760px] text-sm leading-7 text-neutral-700">
      {renderBlocks(text)}
    </div>
  );
}

function renderBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```lang ... ```
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过收尾 ```
      out.push(<CodeBlock key={key++} code={buf.join("\n")} lang={lang} />);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = [
        "mb-3 mt-6 text-xl font-bold text-neutral-900 first:mt-0",
        "mb-2.5 mt-5 text-lg font-semibold text-neutral-900 first:mt-0",
        "mb-2 mt-4 text-base font-semibold text-neutral-900 first:mt-0",
        "mb-1.5 mt-3.5 text-[15px] font-semibold text-neutral-800",
        "mb-1 mt-3 text-sm font-semibold text-neutral-800",
        "mb-1 mt-3 text-sm font-medium text-neutral-700",
      ][lvl - 1];
      out.push(<div key={key++} className={cls}>{inline(h[2])}</div>);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-5 border-neutral-200" />);
      i++;
      continue;
    }

    // 引用（连续 > 行合并）
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(
        <blockquote key={key++} className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900">
          {buf.map((l, j) => <div key={j}>{inline(l)}</div>)}
        </blockquote>
      );
      continue;
    }

    // 表格：| a | b | 且下一行是分隔行
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (l: string) =>
        l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      out.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>{header.map((c, j) => <th key={j} className="border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-left font-medium text-neutral-800">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-neutral-200 px-2.5 py-1.5">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 无序列表（连续 -/*/+ 行；简单支持两级缩进）
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)!;
        items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[2] });
        i++;
      }
      out.push(
        <ul key={key++} className="my-2 space-y-1">
          {items.map((it, j) => (
            <li key={j} className={`flex gap-2 ${it.depth ? "pl-5" : ""}`}>
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
              <span>{inline(it.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 marker:text-neutral-400">
          {items.map((t, j) => <li key={j}>{inline(t)}</li>)}
        </ol>
      );
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 段落（合并连续非空、非特殊行）
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]); i++;
    }
    out.push(<p key={key++} className="my-2">{inline(buf.join(" "))}</p>);
  }
  return out;
}

/** 行内语法：`code` **bold** *italic* [text](url) ~~del~~ */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) {
      return <code key={i} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-rose-700">{p.slice(1, -1)}</code>;
    }
    if (/^\*\*[^*]+?\*\*$/.test(p)) return <strong key={i} className="font-semibold text-neutral-900">{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+?\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^~~[^~]+?~~$/.test(p)) return <del key={i} className="text-neutral-400">{p.slice(2, -2)}</del>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer"
          className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/* ---------------- 代码高亮（轻量正则实现，无外部依赖） ---------------- */

const KEYWORDS: Record<string, string[]> = {
  js: "const let var function return if else for while do class new import from export default async await try catch finally throw this null undefined true false typeof instanceof in of yield static get set extends".split(" "),
  ts: "const let var function return if else for while do class new import from export default async await try catch finally throw this null undefined true false typeof instanceof in of yield static get set extends interface type enum implements readonly public private protected as satisfies keyof infer".split(" "),
  py: "def return if elif else for while class import from as with try except finally raise lambda None True False self pass break continue global nonlocal yield assert del in is not and or async await print".split(" "),
  sh: "if then else elif fi for while do done case esac function echo exit return export local source cd".split(" "),
  sql: "select from where insert into values update set delete create table drop alter add primary key not null unique index join left right inner outer on as and or in like between order by group having limit offset count sum avg min max distinct".split(" "),
  json: "true false null".split(" "),
  java: "public private protected class interface extends implements static final void int long double float boolean char if else for while do return new this super try catch finally throw throws import package enum record var".split(" "),
  go: "func return if else for range var const type struct interface map chan go defer package import nil true false string int bool error".split(" "),
  rust: "fn let mut const struct enum impl trait match if else for while loop return pub use mod crate self super move ref async await true false Some None Ok Err".split(" "),
  c: "int void char float double long short unsigned signed struct union enum typedef if else for while do return break continue static const extern sizeof switch case default".split(" "),
};
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.jsx = KEYWORDS.js;
KEYWORDS.cxx = KEYWORDS.c;
KEYWORDS.cpp = KEYWORDS.c;
KEYWORDS.h = KEYWORDS.c;
KEYWORDS.hpp = KEYWORDS.c;
KEYWORDS.cs = KEYWORDS.java;
KEYWORDS.php = KEYWORDS.js;
KEYWORDS.kotlin = KEYWORDS.java;
KEYWORDS.kt = KEYWORDS.java;
KEYWORDS.swift = KEYWORDS.java;
KEYWORDS.r = KEYWORDS.py;
KEYWORDS.rb = KEYWORDS.py;

const LANG_ALIAS: Record<string, string> = {
  javascript: "js", typescript: "ts", python: "py", shell: "sh", bash: "sh", zsh: "sh",
  rs: "rust", golang: "go", "c++": "cpp", yml: "json", toml: "json", ini: "json",
};

function langOf(lang: string): string {
  const l = (lang || "").toLowerCase();
  return LANG_ALIAS[l] ?? l;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 把一行代码染色成 HTML：单次扫描替换，避免二次正则破坏已插入的 span 标签 */
function highlightLine(line: string, lang: string): string {
  const kw = KEYWORDS[lang];
  const hashComment = ["py", "sh", "rb", "r", "yaml", "toml"].includes(lang);
  const sqlComment = lang === "sql";
  const commentPart = [
    "\\/\\/[^\\n]*$",
    hashComment ? "#(?!\\{)[^\\n]*$" : null,
    sqlComment ? "--[^\\n]*$" : null,
  ].filter(Boolean).join("|");
  const parts = [
    `(${commentPart})`, // 1 注释
    "(\"[^\"]*\"|'[^']*'|`[^`]*`)", // 2 字符串
    kw?.length ? `\\b(${kw.join("|")})\\b` : null, // 3 关键字
    "\\b(\\d+(?:\\.\\d+)?)\\b", // 4 数字
  ].filter(Boolean);
  const re = new RegExp(parts.join("|"), "g");
  return escapeHtml(line).replace(re, (m, com, str, kwMatch, num) => {
    if (com) return `<span class="hl-com">${com}</span>`;
    if (str) return `<span class="hl-str">${str}</span>`;
    if (kwMatch) return `<span class="hl-kw">${kwMatch}</span>`;
    if (num) return `<span class="hl-num">${num}</span>`;
    return m;
  });
}

/** 带行号和语法高亮的代码块 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const l = langOf(lang ?? "");
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1.5">
        <span className="num text-[11px] uppercase text-neutral-400">{lang || "code"}</span>
        <button
          onClick={() => navigator.clipboard?.writeText(code)}
          className="text-[11px] text-neutral-400 opacity-0 transition-opacity hover:text-neutral-900 group-hover/code:opacity-100"
        >
          复制
        </button>
      </div>
      <pre className="overflow-x-auto bg-white px-4 py-3">
        <code className="font-mono text-[12.5px] leading-6">
          {lines.map((ln, i) => (
            <div key={i} className="flex">
              <span className="num mr-3 w-7 shrink-0 select-none text-right text-neutral-300">{i + 1}</span>
              <span
                className="min-w-0 flex-1 whitespace-pre"
                dangerouslySetInnerHTML={{ __html: highlightLine(ln, l) || "&nbsp;" }}
              />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
