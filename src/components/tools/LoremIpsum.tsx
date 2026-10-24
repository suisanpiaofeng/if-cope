"use client";

/** 假文生成：中文 / 英文占位文，可指定段数与字数（排版测试用） */
import { useState } from "react";
import { Actions, Btn, CopyBtn, NumInput, Out, PrimaryBtn, Select } from "./_ui";

const EN_WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum").split(" ");

const ZH = "在学习过程中，学生常常需要处理大量的文献资料与课堂笔记。把零散的知识点整理成结构化的导图、大纲与测验，能够显著提升理解与记忆效率。本工具生成的占位文字仅用于排版与演示，不承载任何真实语义，长度与段落可控，方便测试界面在不同内容量下的显示效果。";

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function enPara(words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(pick(EN_WORDS));
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function zhPara(chars: number): string {
  let s = "";
  while (s.length < chars) s += ZH;
  return s.slice(0, chars) + "。";
}

export default function LoremIpsum() {
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [paras, setParas] = useState(3);
  const [len, setLen] = useState(120);
  const [out, setOut] = useState("");

  function gen() {
    const n = Math.max(1, Math.min(20, paras));
    const mk = lang === "zh" ? () => zhPara(len) : () => enPara(Math.max(10, Math.min(200, len)));
    setOut(Array.from({ length: n }, mk).join("\n\n"));
  }

  return (
    <div className="max-w-[640px]">
      <Actions>
        <Select label="语言" value={lang} onChange={setLang}
          options={[{ value: "zh", label: "中文" }, { value: "en", label: "English" }]} />
        <span className="text-xs text-neutral-500">段数</span><NumInput value={paras} onChange={setParas} min={1} max={20} className="w-20" />
        <span className="text-xs text-neutral-500">{lang === "zh" ? "每段字数" : "每段词数"}</span>
        <NumInput value={len} onChange={setLen} min={10} max={500} className="w-24" />
        <PrimaryBtn onClick={gen}>生成</PrimaryBtn>
        <CopyBtn text={out} label="复制全部" />
      </Actions>
      <Out label="占位文" value={out} />
    </div>
  );
}
