"use client";

/**
 * 课堂专区首次使用合规声明拦截（规格 §7，硬要求）。
 * 声明文本单一事实源 = docs/课堂专区-架构规格-v2-20261028.md §7；
 * 版本号钉住：声明更新时改版本即可让旧同意失效重新拦截。
 */
export const DISCLAIMER_VERSION = "2026-10-28-v2";

const ITEMS = [
  "本工具为**非官方**个人学习助手，与学校无隶属关系、未获学校授权。",
  "仅供**个人学习用途**；只使用你本人的账号登录，只处理你有权访问的课程内容。",
  "**不做批量抓取、不二次分发**：不镜像、不公开部署、不向任何第三方转发课程内容。",
  "登录凭据**只保存在你本机浏览器**（localhost 域），应用不上传、无遥测。",
  "课程资料属于学校教学资源，生成的笔记**请勿公开转发**。",
  "AI 生成内容可能出错，**以课程原始内容为准**。",
];

export default function DisclaimerGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[85vh] w-[480px] max-w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold tracking-tight">课堂专区 · 使用前须知</h2>
        <p className="mt-1 text-[11px] text-neutral-400">声明版本 {DISCLAIMER_VERSION}</p>
        <ul className="mt-4 space-y-2.5">
          {ITEMS.map((t, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-5 text-neutral-700">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
              <span>{t.split("**").map((seg, j) =>
                j % 2 === 1 ? <strong key={j} className="font-medium text-neutral-900">{seg}</strong> : <span key={j}>{seg}</span>
              )}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-5 text-amber-800">
          公开部署/镜像/转发本能力前必须获得学校同意（本地个人使用不受此限）。
        </p>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onAccept}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-neutral-700">
            我已阅读并同意
          </button>
        </div>
      </div>
    </div>
  );
}
