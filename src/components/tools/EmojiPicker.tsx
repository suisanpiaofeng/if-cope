"use client";

/** Emoji 选择器：分类 + 搜索 + 最近使用，点击复制 */
import { useMemo, useState } from "react";
import { useMounted } from "./_ui";

const CATS: { name: string; emojis: string[] }[] = [
  { name: "笑脸", emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕".split(" ") },
  { name: "手势", emojis: "👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 💪 🦾 ✍️ 💅 👏 🙌 👐 🤲 🫱 🫲 🤝 🫶 🫡".split(" ") },
  { name: "心", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ 🔥 💫 ⭐ 🌟 💥 💯 🔥".split(" ") },
  { name: "动物", emojis: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦅 🦉 🦋 🐝 🐞 🐢 🐍 🐙 🦀 🐬 🐳 🦖 🦕 🐴 🦄 🐝 🐌 🐞 🦂 🦟 🦗 🕷".split(" ") },
  { name: "食物", emojis: "🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🥝 🍅 🥑 🥦 🥕 🌽 🌶 🥔 🍞 🥐 🧀 🥚 🍳 🥞 🍕 🍔 🌮 🌯 🍜 🍣 🍛 🍱 🍤 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍯 🥛 ☕ 🍵".split(" ") },
  { name: "活动", emojis: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🚀 🛸 ✈️ 🚁 🚗 🚕 🚌 🏍️ 🚲 🛴 🏆 🥇 🥈 🥉 🎫 🎭 🎨 🎬 🎤 🎧 🎸 🎹 🎺 🥁 📚 📝 ✏️ 📎 📌 📍 ✂️ 🖊️".split(" ") },
  { name: "符号", emojis: "✅ ❌ ⭕ ❗ ❓ ⚠️ 🚫 ♻️ 🔱 ⚛️ ☢️ ☣️ 📴 📳 🔕 🔔 🔊 🔇 ⏰ ⏳ 💡 🔑 🔓 🔒 🔑 ➕ ➖ ✖️ ➗ ♾️ 💯 🔠 🔡 🔤 🆗 🆕 🆒 🆓 🆙 🆒 🅿️ ⚪ ⚫ 🔴 🟢 🟡 🔵 🟠 🟣".split(" ") },
];

const RECENT_KEY = "ifcope.tools.emoji-recent";
const MAX_RECENT = 24;

export default function EmojiPicker() {
  const mounted = useMounted();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [copied, setCopied] = useState("");

  // 挂载后读最近使用
  useMemo(() => {
    if (mounted) {
      try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")); } catch { /* ignore */ }
    }
  }, [mounted]);

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return CATS;
    return [{ name: "搜索", emojis: CATS.flatMap((c) => c.emojis).filter((e) => query.split(/\s+/).every((w) => e.includes(w))) }];
  }, [q]);

  function copy(e: string) {
    navigator.clipboard?.writeText(e).catch(() => {});
    setCopied(e);
    setTimeout(() => setCopied(""), 900);
    setRecent((prev) => {
      const next = [e, ...prev.filter((x) => x !== e)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div className="max-w-[640px]">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 emoji（可输入中文/英文描述或直接粘贴 emoji）"
        className="mb-3 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400" />
      <div className="max-h-[460px] overflow-y-auto pr-1">
        {mounted && recent.length > 0 && !q && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-400">最近使用</div>
            <div className="flex flex-wrap gap-0.5">
              {recent.map((e, i) => (
                <button key={i} onClick={() => copy(e)} className="rounded p-1.5 text-2xl hover:bg-neutral-100">{e}</button>
              ))}
            </div>
          </div>
        )}
        {filtered.map((c) => c.emojis.length > 0 && (
          <div key={c.name} className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-400">{c.name}</div>
            <div className="flex flex-wrap gap-0.5">
              {c.emojis.map((e, i) => (
                <button key={i} onClick={() => copy(e)} title={copied === e ? "已复制" : ""}
                  className={`rounded p-1.5 text-2xl hover:bg-neutral-100 ${copied === e ? "bg-neutral-200" : ""}`}>{e}</button>
              ))}
            </div>
          </div>
        ))}
        {q && filtered[0].emojis.length === 0 && (
          <div className="py-6 text-center text-xs text-neutral-400">没有匹配的 emoji</div>
        )}
      </div>
      <div className="mt-2 text-[11px] text-neutral-400">点击即复制到剪贴板。</div>
    </div>
  );
}
