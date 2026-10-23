"use client";

/** 闪卡渲染：## 卡片 N + 加粗 Q：/ A： 标记 → 翻牌记忆卡 */
import { useMemo, useState } from "react";

type Card = { q: string; a: string };

function parseCards(content: string): Card[] {
  const cards: Card[] = [];
  const sections = content.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const q = sec.match(/\*\*Q[：:]\*\*\s*([\s\S]*?)(?=\*\*A[：:]\*\*)/i)?.[1]?.trim();
    const a = sec.match(/\*\*A[：:]\*\*\s*([\s\S]*)$/i)?.[1]?.trim();
    if (q && a) cards.push({ q, a });
    else {
      // 容错：无标记格式时，卡片标题=问题，正文=答案
      const [head, ...rest] = sec.split("\n");
      const body = rest.join("\n").trim();
      if (head?.trim() && body) cards.push({ q: head.trim(), a: body });
    }
  }
  return cards;
}

export default function Flashcards({ content }: { content: string }) {
  const cards = useMemo(() => parseCards(content), [content]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (cards.length === 0) {
    return <pre className="whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">{content}</pre>;
  }
  const card = cards[i];

  return (
    <div className="mx-auto max-w-[640px]">
      <div
        onClick={() => setFlipped((f) => !f)}
        className="cursor-pointer select-none border-2 border-neutral-900 bg-white p-8 shadow-[4px_4px_0_0_rgba(0,0,0,0.12)] transition-transform active:translate-y-0.5"
        style={{ minHeight: 220 }}
      >
        <div className="num mb-3 text-[11px] text-neutral-400">
          {i + 1} / {cards.length} · {flipped ? "答案" : "问题"}（点击翻面）
        </div>
        {flipped ? (
          <div className="text-base leading-7 text-neutral-800">{card.a}</div>
        ) : (
          <div className="text-lg font-semibold leading-8 text-neutral-900">{card.q}</div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => { setI((x) => Math.max(0, x - 1)); setFlipped(false); }}
          disabled={i === 0}
          className="border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40"
        >
          ← 上一张
        </button>
        <span className="num text-xs text-neutral-400">{flipped ? "再点一下翻回" : "想不起来就点开看答案"}</span>
        <button
          onClick={() => { setI((x) => Math.min(cards.length - 1, x + 1)); setFlipped(false); }}
          disabled={i === cards.length - 1}
          className="border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40"
        >
          下一张 →
        </button>
      </div>
    </div>
  );
}
