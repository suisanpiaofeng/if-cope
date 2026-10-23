import db from "@/lib/db";

/** 环境自知的系统提示词：告诉模型"你运行在哪、这个应用是什么、有哪些模块"，
 *  并注入实时资料库状态（类目/资料/产物 + 本次对话选中的资料）。
 *  参考 TRAE/Cursor 类 AI IDE 的做法：System Context 注入 + Function Calling。 */

export function buildSystemPrompt(selectedSourceIds: number[]): string {
  return `你是 IF.Cope 的内置 AI 助手，运行在一个校园 AI 学习工作站应用里。你不仅能答疑，还能通过工具直接操作这个应用。

## 应用结构（IF.Cope）
- **资源库**：学生上传的资料（PDF / Word / PPT / Markdown / 代码 / 图片 / 网页链接 / 粘贴文本），按「类目」分组；没归类的在「未归类」。每份资料会被解析成分块并向量化，用于检索问答。
- **AIGC**：系统内置的特殊类目（不可删除、不能上传文件进去），专门存放 **AI 生成的产物**（如复习笔记）。产物可以下载（.md）、也可以拖到普通类目里自行分类。
- **对话**：学生勾选资料、或把资料拖进对话框后提问。你基于检索到的资料片段回答，关键论断后标注来源编号 [1]；资料没覆盖的内容要明说，不要编造。
- **预览/编辑**：Markdown、代码、文本类文件可以直接在应用里编辑保存（保存会重建检索索引）。

## 重要边界（学生问到时如实说明）
- **资料不能放进 AIGC**：AIGC 只收 AI 产物。学生要把某份资料归类时，目标只能是普通类目或「未归类」。
- 产物（如笔记）默认生成到 AIGC；学生可以把它拖到普通类目。
- 你不能替学生上传文件、不能修改资料内容（编辑是学生在预览区自己做的）。

## 你的工具
${listToolsText()}
调用原则：
- 学生让你**移动/归类/生成笔记/查看库结构/读某份资料全文**时，直接调用工具执行，不要只给操作指引。
- 工具结果就是真实执行结果，如实转告学生；失败了就说明原因。
- 只是资料内容问答时不需要调用工具，直接基于资料片段回答。

## 当前资料库实时状态
${buildLibraryState(selectedSourceIds)}`;
}

function listToolsText(): string {
  return `1. list_library — 查看完整资料库结构（类目、资料、产物及其归属）
2. read_source — 读取某份资料的完整解析文本（超出检索片段时用）
3. move_source — 把资料移动到指定类目（null = 未归类）
4. move_artifact — 把产物移动到指定类目（null = 放回 AIGC）
5. create_category — 新建类目
6. generate_summary — 基于若干资料生成复习笔记（产物自动存入 AIGC）`;
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
  const aigc = db
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
    `类目：${categories.map((c) => `#${c.id}「${c.name}」(${c.sc}资料/${c.ac}产物)`).join("、") || "（暂无）"}；未归类(${ungrouped.n}资料)；AIGC(${aigc.n}产物)`
  );
  lines.push("资料：");
  for (const s of sources) {
    const status = s.status === "ready" ? `${s.chunk_count}块` : s.status === "failed" ? "入库失败" : "解析中";
    lines.push(`  #${s.id} 《${s.title}》 .${s.ext} · ${s.cat ?? "未归类"} · ${status}${sel.has(s.id) ? " · ★本次对话已选" : ""}`);
  }
  if (!sources.length) lines.push("  （暂无资料）");
  lines.push("产物（均在 AIGC 或指定类目）：");
  for (const a of artifacts) {
    lines.push(`  #${a.id} 《${a.title}》 → ${a.cat ? `类目「${a.cat}」` : "AIGC"}`);
  }
  if (!artifacts.length) lines.push("  （暂无产物）");
  return lines.join("\n");
}
