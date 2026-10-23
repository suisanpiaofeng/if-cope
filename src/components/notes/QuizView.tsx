"use client";

/** 测验渲染：## 第N题 + 选项 + 加粗答案/解析标记 → 自测题卡片 */
import { useMemo, useState } from "react";

type Question = { stem: string; options: string[]; answer: string; explain: string };

function parseQuestions(content: string): Question[] {
  const out: Question[] = [];
  const sections = content.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const options: string[] = [];
    const optRe = /^[-*]\s*([A-D][.、:：])\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = optRe.exec(sec))) options.push(`${m[1]} ${m[2].trim()}`);
    const answer = sec.match(/\*\*答案[：:]\*\*\s*([A-D对错]+)/i)?.[1]?.trim() ?? "";
    const explain = sec.match(/\*\*解析[：:]\*\*\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "";
    // 题干 = 第一个选项/答案/解析之前的文本（去掉“第N题”标题行）
    const cutAt = [sec.search(optRe), sec.search(/\*\*答案/), sec.search(/\*\*解析/)]
      .filter((x) => x >= 0);
    const stem = (cutAt.length ? sec.slice(0, Math.min(...cutAt)) : sec)
      .split("\n")
      .slice(1) // 去掉 "第 N 题" 行
      .join("\n")
      .trim();
    if (stem || options.length) out.push({ stem, options, answer, explain });
  }
  return out;
}

export default function QuizView({ content }: { content: string }) {
  const questions = useMemo(() => parseQuestions(content), [content]);
  const [shown, setShown] = useState<Set<number>>(new Set());

  if (questions.length === 0) {
    return <pre className="whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">{content}</pre>;
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4">
      {questions.map((q, i) => (
        <div key={i} className="border border-neutral-200 p-4">
          <div className="font-semibold leading-7 text-neutral-900">
            {i + 1}. {q.stem || "（无题干）"}
          </div>
          {q.options.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm leading-6 text-neutral-700">
              {q.options.map((o, j) => (
                <li key={j} className="pl-1">{o}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() =>
              setShown((s) => {
                const n = new Set(s);
                if (n.has(i)) n.delete(i);
                else n.add(i);
                return n;
              })
            }
            className="mt-3 border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          >
            {shown.has(i) ? "收起答案" : "显示答案"}
          </button>
          {shown.has(i) && (
            <div className="mt-2 border-l-2 border-emerald-500 bg-emerald-50/60 px-3 py-2 text-sm leading-6">
              <div className="font-semibold text-emerald-700">答案：{q.answer || "—"}</div>
              {q.explain && <div className="mt-1 text-neutral-700">解析：{q.explain}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
