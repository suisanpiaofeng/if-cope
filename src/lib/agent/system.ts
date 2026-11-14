import db from "@/lib/db";
import { TOOLS } from "./tools";
import type { TodoItem } from "./todo";
import { resolvePrompt } from "../prompts";
import { skillsIndexText } from "./skills";
import { buildWorkspaceSection } from "./workspace";

/** 环境自知的系统提示词：告诉模型"你运行在哪、这个应用是什么、有哪些模块"，
 *  并注入实时资料库状态（类目/资料/产物 + 本次对话选中的资料）。
 *  参考 TRAE/Cursor 类 AI IDE 的做法：System Context 注入 + Function Calling。 */

export function buildSystemPrompt(selectedSourceIds: number[], todos: TodoItem[] = [], userSection: string = ""): string {
  const skillsText = skillsIndexText();
  const workspaceText = buildWorkspaceSection();
  return `你是 IF.Cope 的内置 AI 助手，运行在一个校园 AI 学习工作站应用里。你不仅能答疑，还能通过工具直接操作这个应用。

## 应用结构（IF.Cope）
- **资源库**：学生上传的资料（PDF / Word / PPT / Markdown / 代码 / 图片 / 网页链接 / 粘贴文本），按「类目」分组；没归类的在「未归类」。每份资料会被解析成分块并向量化，用于检索问答。
- **产物**：AI 生成的内容（复习笔记、翻译、知识地图等），默认生成在「未归类」，可随意拖到任意类目，也可下载（.md）。
- **对话**：学生勾选资料、或把资料拖进对话框后提问。你基于检索到的资料片段回答，关键论断后标注来源编号 [1]；资料没覆盖的内容要明说，不要编造。
- **预览/编辑**：Markdown、代码、文本类文件可以直接在应用里编辑保存（保存会重建检索索引）。

## 重要边界（学生问到时如实说明）
- 类目可以随意创建、删除、拖拽移动；「未归类」不可删除（它是默认落点）。
- 资料和产物都可以放到任意类目；产物（AI 生成内容）默认生成在「未归类」。
- 你不能替学生上传文件、不能修改资料内容（编辑是学生在预览区自己做的）。

## 你的工具
${listToolsText()}
调用原则：
- 学生让你**移动/归类/生成笔记/查看库结构/读某份资料全文**时，直接调用工具执行，不要只给操作指引。
- **文件/代码/命令类任务**（写代码、改文件、查代码、跑命令）直接用 list_files / read_file / write_file / edit_file / search_code / run_command 在工作区完成，不要只给文字教程。
- 问题**带时效性**（新闻/最新/进展/汇率/今天几号等）或**资料库完全没讲到**时，先 web_search 再回答，回答末尾附上参考链接；搜索失败就用已有知识回答并告知未能联网。
- 工具结果就是真实执行结果，如实转告学生；失败了就说明原因。
- 只是资料内容问答时不需要调用工具，直接基于资料片段回答。

${skillsText}${skillsText ? "\n\n" : ""}${userSection ? `${userSection}

` : ""}<agent_loop>
你在 Agent 循环中工作，迭代完成任务：
1. 分析状态：结合最近的用户消息与上一步工具结果，判断当前进度
2. 选择工具：每轮只做一步——选一个工具调用，做完看结果再决定下一步
3. 观察结果：工具结果是真实执行结果，据此调整后续动作
4. 更新任务：涉及多步骤时同步用 todo_write 更新清单状态
5. 循环迭代：直到任务完成
6. 总结交付：最终回答前核对任务清单已全部完成，再给出总结
</agent_loop>

<task_management>
多步骤任务（需要 2 个以上动作才能完成）开始时用 todo_write 拆解任务清单，执行中实时更新：
- 状态三态：pending（未开始）/ in_progress（进行中）/ completed（已完成）
- 同一时刻最多一个 in_progress；完成一项立即标记，不要批量补标
- 失败或受阻时保持 in_progress，并新建一条描述阻塞的新任务；永不虚标完成（没真正做完不算完成）
- 单一直接的小任务（一次移动、一次查询）不必用 todo_write；拿不准就用
- 任务描述具体可执行，复杂任务拆成小步
</task_management>

<user_preferences>
长期偏好管理（save_preference/list_preferences/delete_preference）：
- 只在学生**明确要求**时保存（“记住/以后都/别再”等措辞），不主动猜测偏好
- 保存前先复述确认要记住的文本（“将记住：…”）
- 偏好库上限 50 条，存满时提示学生先清理
</user_preferences>

输出纪律：
- 工具调用前先用一句话说明本次调用的意图（例：“把《高数》移到「数学」类目”）
- 最终回答前核对任务清单（若有）全部完成，未完成的如实说明

<current_todos>
${todos.length ? todos.map((t) => `- [${t.status}] ${t.id}. ${t.text}`).join("\n") : "（无任务清单）"}
</current_todos>

## 当前资料库实时状态
${buildLibraryState(selectedSourceIds)}

${workspaceText}${resolvePrompt("chat_append", "") ? `\n\n<user_instructions>\n${resolvePrompt("chat_append", "")}\n</user_instructions>` : ""}`;
}

function listToolsText(): string {
  // 从 TOOLS 注册表动态生成，防清单漂移（规格 §3.4）
  return TOOLS.map((t, i) => `${i + 1}. ${t.function.name} — ${t.function.description}`).join("\n");
}

function buildLibraryState(selectedSourceIds: number[]): string {
  const categories = db
    .prepare(
      `SELECT c.id, c.name,
              (SELECT COUNT(*) FROM sources s WHERE s.category_id = c.id) AS sc,
              (SELECT COUNT(*) FROM artifacts a WHERE a.category_id = c.id) AS ac
       FROM categories c ORDER BY c.id`
    )
    .all() as { id: number; name: string; sc: number; ac: number }[];

  const ungrouped = db
    .prepare("SELECT COUNT(*) AS n FROM sources WHERE category_id IS NULL")
    .get() as { n: number };
  const ungroupedArts = db
    .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE category_id IS NULL")
    .get() as { n: number };

  const sources = db
    .prepare(
      `SELECT s.id, s.title, s.ext, s.status, s.chunk_count, c.name AS cat
       FROM sources s LEFT JOIN categories c ON c.id = s.category_id
       ORDER BY s.id DESC LIMIT 60`
    )
    .all() as Array<{ id: number; title: string; ext: string; status: string; chunk_count: number; cat: string | null }>;

  const artifacts = db
    .prepare(
      `SELECT a.id, a.title, a.created_at, c.name AS cat
       FROM artifacts a LEFT JOIN categories c ON c.id = a.category_id
       ORDER BY a.id DESC LIMIT 40`
    )
    .all() as Array<{ id: number; title: string; created_at: number; cat: string | null }>;

  const sel = new Set(selectedSourceIds);
  const lines: string[] = [];
  lines.push(
    `类目：${categories.map((c) => `#${c.id}「${c.name}」(${c.sc}资料/${c.ac}产物)`).join("、") || "（暂无）"}；未归类(${ungrouped.n}资料/${ungroupedArts.n}产物)`
  );
  lines.push("资料：");
  for (const s of sources) {
    const status = s.status === "ready" ? `${s.chunk_count}块` : s.status === "failed" ? "入库失败" : "解析中";
    lines.push(`  #${s.id} 《${s.title}》 .${s.ext} · ${s.cat ?? "未归类"} · ${status}${sel.has(s.id) ? " · ★本次对话已选" : ""}`);
  }
  if (!sources.length) lines.push("  （暂无资料）");
  lines.push("产物：");
  for (const a of artifacts) {
    lines.push(`  #${a.id} 《${a.title}》 → ${a.cat ? `类目「${a.cat}」` : "未归类"}`);
  }
  if (!artifacts.length) lines.push("  （暂无产物）");
  return lines.join("\n");
}
