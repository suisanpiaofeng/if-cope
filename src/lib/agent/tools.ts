import db from "@/lib/db";
import { generateSummary } from "@/lib/artifact";
import { webSearch, webHitsToContext } from "@/lib/webSearch";
import { replaceTodos, type TodoItem } from "./todo";
import { listPrefs, savePref, deletePref, countPrefs, PREFS_MAX } from "./prefs";
import { SKILL_TOOL, executeLoadSkill, listSkills, writeSkill, isValidSkillName } from "./skills";
import { planImport, injectName } from "./skillImport";
import { workspaceRoot, resolveInWorkspace, listFilesTree } from "./workspace";
import { executeCommand } from "./command";
import { classifyCommand } from "./confirm";
import fs from "node:fs";
import path from "node:path";

/** Agent 工具：OpenAI function calling 格式。
 *  定义（TOOLS）给模型看；executeTool（执行器）在服务端真实操作数据库。
 *  模型只传 id/参数，所有写操作都在这里做校验。 */

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

/** 工具执行上下文（todo_write 等会话级工具需要知道归属会话） */
export type ToolContext = { threadId: number; loadedSkills?: Set<string> };

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_library",
      description: "查看完整资料库结构：所有类目、资料（含状态/所属类目）、产物（含归属）",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_source",
      description: "读取某份资料的完整解析文本（分块拼接）。当检索片段不够回答问题时使用",
      parameters: {
        type: "object",
        properties: { source_id: { type: "integer", description: "资料 id" } },
        required: ["source_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_source",
      description: "把资料移动到指定类目；null = 未归类",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "integer", description: "资料 id" },
          category_id: { type: ["integer", "null"], description: "目标类目 id；null = 未归类" },
        },
        required: ["source_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_artifact",
      description: "把产物（笔记等 AI 生成内容）移动到指定类目；产物默认生成在未归类；null = 未归类",
      parameters: {
        type: "object",
        properties: {
          artifact_id: { type: "integer", description: "产物 id" },
          category_id: { type: ["integer", "null"], description: "目标类目 id；null = 未归类" },
        },
        required: ["artifact_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_category",
      description: "新建一个资料类目（文件夹）",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "类目名" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_summary",
      description: "基于若干资料生成结构化中文复习笔记（markdown），产物存入未归类",
      parameters: {
        type: "object",
        properties: {
          source_ids: { type: "array", items: { type: "integer" }, description: "要基于哪些资料生成（资料 id 列表）" },
        },
        required: ["source_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "联网搜索网页：时效性问题（新闻/最新进展/今日事件）、资料库未覆盖的知识、需要实时数据（汇率/日期/版本号）时使用。返回标题+链接+摘要",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（提炼核心词，不要整句提问，20 字内效果最好）" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_write",
      description: "更新当前对话的任务清单（传入完整清单，幂等覆盖）。多步骤任务开始时先拆解清单，执行中实时更新状态",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer", description: "任务序号" },
                text: { type: "string", description: "任务描述" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "状态" },
              },
              required: ["id", "text", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_preference",
      description: "记住学生的长期偏好（仅当学生明确说「记住/以后都/别再」等时调用）。存入前复述确认文本；同文本幂等不重复",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "偏好描述（一句话，如：回答别用列表）" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_preferences",
      description: "列出全部长期偏好（id + 文本）",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_preference",
      description: "删除一条长期偏好",
      parameters: {
        type: "object",
        properties: { id: { type: "integer", description: "偏好 id（从 list_preferences 得到）" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出工作区某目录的文件（名称/类型/大小/修改时间）。path 缺省 = 工作区根",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "工作区内相对路径（目录）" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取工作区文件内容（带行号）。大文件用 offset/limit 分段读",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内相对路径" },
          offset: { type: "integer", description: "起始行号（缺省 1）" },
          limit: { type: "integer", description: "读取行数（缺省 400，上限 400）" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入工作区文件（自动建中间目录）。覆盖已有文件需显式 overwrite",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内相对路径" },
          content: { type: "string", description: "完整文件内容" },
          overwrite: { type: "boolean", description: "目标已存在时是否覆盖（缺省 false）" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "精确替换文件中的文本（old 必须唯一匹配；多处需 replace_all）。优先于整文件重写",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内相对路径" },
          old: { type: "string", description: "要替换的原文（精确匹配）" },
          new: { type: "string", description: "替换后文本" },
          replace_all: { type: "boolean", description: "多处匹配时是否全部替换（缺省 false）" },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description: "在工作区内搜索代码/文本（grep 式）。返回 文件:行号:内容，上限 100 条",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索词或正则" },
          glob: { type: "string", description: "文件过滤，如 **/*.ts 或 *.md" },
          regex: { type: "boolean", description: "query 按正则处理（缺省字面量）" },
          case_insensitive: { type: "boolean", description: "忽略大小写（缺省 false）" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在工作区执行命令（受限：黑名单命令直接拒绝；写类/删除类命令需学生确认）。超时默认 30s，输出截断 20k",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          timeout_ms: { type: "integer", description: "超时毫秒（缺省 30000，上限 120000）" },
        },
        required: ["command"],
      },
    },
  },
  SKILL_TOOL,
  {
    type: "function",
    function: {
      name: "create_skill",
      description: "创建/安装一个技能（SKILL.md 指令包）。学生说「帮我创建 XX 技能」时，生成完整技能正文并注册，无需学生手动操作",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "技能名（小写字母/数字/连字符，如 wrong-note）" },
          description: { type: "string", description: "触发描述：何时使用该技能" },
          body: { type: "string", description: "技能正文（Markdown：步骤/模板/约束，模型加载后遵循）" },
          triggers: { type: "string", description: "触发条件（可选，逗号分隔）" },
          overwrite: { type: "boolean", description: "同名技能已存在时是否覆盖（缺省 false）" },
        },
        required: ["name", "description", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description: "把资料库里的一份 md/文本资料直接注册为技能（自动生成元数据）。学生上传 md 后说「把这个装成技能」时使用",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "integer", description: "资料 id" },
          name: { type: "string", description: "技能名（可选；资料名非英文时建议指定）" },
          overwrite: { type: "boolean", description: "同名技能已存在时是否覆盖（缺省 false）" },
        },
        required: ["source_id"],
      },
    },
  },
] as const;

/** 执行工具调用：返回给模型的文本结果；失败抛错（由调用方转成错误文本回喂模型） */

/** 文件不存在时的友好报错：附相近文件名建议（同名/同后缀，上限 5 个） */
function fileNotFoundMsg(rel: string): string {
  const base = path.basename(rel).toLowerCase();
  const ext = path.extname(rel).toLowerCase();
  const candidates = listFilesTree("", 8)
    .filter((n) => n.type === "file")
    .filter((n) => n.name.toLowerCase().includes(base.replace(ext, "")) || (ext && n.path.toLowerCase().endsWith(ext)))
    .slice(0, 5)
    .map((n) => n.path);
  return `文件不存在：${rel}。${candidates.length ? `相近文件：${candidates.join("、")}（用 read_file 或 list_files 确认路径）` : "用 list_files 浏览工作区结构确认路径"}`;
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  switch (call.name) {
    case "save_preference": {
      const text = String(call.args.text ?? "").trim();
      if (!text) throw new Error("偏好文本不能为空");
      if (countPrefs() >= PREFS_MAX) {
        return `偏好库已满（${PREFS_MAX} 条上限）：请先用 delete_preference 清理后再存，或提醒学生到设置页管理。`;
      }
      const { id, created } = savePref(text);
      return created
        ? `已记住偏好 #${id}：「${text}」（后续对话会生效）`
        : `该偏好已存在（#${id}），未重复保存：「${text}」`;
    }

    case "list_preferences": {
      const prefs = listPrefs();
      return prefs.length
        ? `共 ${prefs.length} 条偏好：
${prefs.map((p) => `#${p.id} ${p.text}`).join("\n")}`
        : "（还没有保存任何偏好）";
    }

    case "delete_preference": {
      const id = Number(call.args.id);
      if (!Number.isInteger(id)) throw new Error("id 必须是整数");
      return deletePref(id) ? `已删除偏好 #${id}` : `偏好 #${id} 不存在`;
    }

    case "load_skill":
      return executeLoadSkill(call.args, ctx);

    case "create_skill": {
      const name = String(call.args.name ?? "").trim();
      const description = String(call.args.description ?? "").trim();
      const bodyText = String(call.args.body ?? "").trim();
      if (!isValidSkillName(name)) throw new Error("技能名非法：仅允许小写字母/数字/连字符，≤40 位");
      if (!bodyText) throw new Error("技能正文 body 不能为空");
      const exist = listSkills().find((s) => s.name === name);
      if (exist && !call.args.overwrite) {
        throw new Error(`技能「${name}」已存在（描述：${exist.description || "无"}）。确认覆盖请带 overwrite:true，或换个名字`);
      }
      writeSkill(name, description, bodyText, exist ? exist.enabled : true, {
        triggers: call.args.triggers ? String(call.args.triggers) : undefined,
      });
      return `已${exist ? "覆盖" : ""}安装技能「${name}」。学生可在设置页「技能」里查看/启停；对话中任务匹配描述时会自动加载`;
    }

    case "install_skill": {
      const id = Number(call.args.source_id);
      if (!Number.isInteger(id)) throw new Error("source_id 必须是整数");
      const src = db.prepare("SELECT id, title, ext, status FROM sources WHERE id = ?").get(id) as
        | { id: number; title: string; ext: string; status: string }
        | undefined;
      if (!src) throw new Error(`资料 #${id} 不存在`);
      const chunks = db.prepare("SELECT text FROM chunks WHERE source_id = ? ORDER BY idx").all(id) as { text: string }[];
      if (!chunks.length) return `《${src.title}》没有可安装的文本（非文本类型或入库失败），无法注册为技能`;
      const content = chunks.map((c) => c.text).join("\n\n");
      // name 覆盖：注入/替换 frontmatter name 行（不嵌套，复用 planImport 的元数据生成）
      const nameArg = call.args.name ? String(call.args.name).trim() : "";
      const payload = nameArg ? injectName(content, nameArg) : content;
      const plan = planImport([{ path: `${src.title}.md`, content: payload }], listSkills().map((s) => s.name));
      if (plan.errors.length) throw new Error(`${plan.errors[0].error}（请带 name 参数指定技能名，如 name: my-skill）`);
      if (plan.conflicts.length && !call.args.overwrite) {
        throw new Error(`技能「${plan.conflicts[0].name}」已存在（描述：${listSkills().find((s) => s.name === plan.conflicts[0].name)?.description || "无"}）。确认覆盖请带 overwrite:true`);
      }
      const ins = plan.installs[0] ?? { ...plan.conflicts[0], overwrite: true };
      const prev = listSkills().find((s) => s.name === ins.name);
      writeSkill(ins.name, ins.description, ins.body, prev ? prev.enabled : true, { triggers: ins.triggers, params: ins.params });
      return `已把资料《${src.title}》注册为技能「${ins.name}」（描述：${ins.description || "无"}）。可在设置页「技能」里查看`;
    }

    case "run_command": {
      const cmd = String(call.args.command ?? "").trim();
      if (!cmd) throw new Error("缺少 command");
      if (classifyCommand(cmd) === "deny") throw new Error("命令被安全策略拒绝（黑名单命中）");
      const t = Math.min(120_000, Math.max(1_000, Number(call.args.timeout_ms ?? 30_000) || 30_000));
      const r = await executeCommand(cmd, t);
      return `${r.timedOut ? `命令超时（${t}ms）已终止` : `命令退出码 ${r.code}`}：\n${r.output || "（无输出）"}`;
    }

    case "list_files": {
      const dirAbs = resolveInWorkspace(String(call.args.path ?? ""));
      if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
        throw new Error(`目录不存在：${String(call.args.path ?? "") || "（根）"}。用 list_files 不带参数可看工作区根`);
      }
      const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).slice(0, 200).map((e) => {
        const abs = path.join(dirAbs, e.name);
        const st = fs.statSync(abs);
        return e.isDirectory()
          ? { name: e.name, type: "dir", path: (String(call.args.path ?? "").replace(/\/$/, "") + "/" + e.name).replace(/^\//, "") }
          : { name: e.name, type: "file", size: st.size, mtime: Math.round(st.mtimeMs) };
      });
      return JSON.stringify(entries, null, 1);
    }

    case "read_file": {
      const rel = String(call.args.path ?? "");
      const abs = resolveInWorkspace(rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(fileNotFoundMsg(rel));
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
      const offset = Math.max(1, Number(call.args.offset ?? 1) || 1);
      const limit = Math.min(400, Math.max(1, Number(call.args.limit ?? 400) || 400));
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      let text = slice.map((l, i) => `${offset + i}| ${l.slice(0, 500)}`).join("\n");
      if (text.length > 24000) text = text.slice(0, 24000) + "\n……（已截断，用 offset+limit 续读）";
      return `《${rel}》第 ${offset}-${offset + slice.length - 1} 行（共 ${lines.length} 行）：\n${text}`;
    }

    case "write_file": {
      const rel = String(call.args.path ?? "");
      const abs = resolveInWorkspace(rel);
      const content = String(call.args.content ?? "");
      if (fs.existsSync(abs) && fs.statSync(abs).isFile() && !call.args.overwrite) {
        const head = fs.readFileSync(abs, "utf8").split(/\r?\n/).slice(0, 20).join("\n");
        throw new Error(`文件已存在：${rel}。确认覆盖请带 overwrite:true。原文件前 20 行：\n${head}`);
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return `已写入 ${rel}（${content.split(/\r?\n/).length} 行，${content.length} 字符）`;
    }

    case "edit_file": {
      const rel = String(call.args.path ?? "");
      const abs = resolveInWorkspace(rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(fileNotFoundMsg(rel));
      const oldText = String(call.args.old ?? "");
      const newText = String(call.args.new ?? "");
      if (!oldText) throw new Error("old 不能为空");
      const src = fs.readFileSync(abs, "utf8");
      const parts = src.split(oldText);
      const matches = parts.length - 1;
      if (!matches) throw new Error(`未找到匹配文本。请先 read_file 确认精确原文（含缩进/空白）：${rel}`);
      if (matches > 1 && !call.args.replace_all) {
        const lines = src.split(/\r?\n/);
        const at: number[] = [];
        lines.forEach((l, i) => { if (l.includes(oldText.split(/\r?\n/)[0])) at.push(i + 1); });
        throw new Error(`匹配到 ${matches} 处（行号约 ${at.slice(0, 10).join(", ")}）。确认全部替换请带 replace_all:true`);
      }
      fs.writeFileSync(abs, parts.join(newText));
      return `已替换 ${matches} 处（${rel}）`;
    }

    case "search_code": {
      const query = String(call.args.query ?? "").trim();
      if (!query) throw new Error("缺少 query");
      const flags = call.args.case_insensitive ? "gi" : "g";
      const re = call.args.regex
        ? new RegExp(query, flags)
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      const glob = String(call.args.glob ?? "").trim();
      const hitGlob = (rel: string) => {
        if (!glob) return true;
        const m = glob.match(/^\*\*?(?:\/(\*\*))?\.(\w+)$/);
        if (m) return rel.endsWith(`.${m[2]}`);
        if (glob.endsWith("/**")) return rel.startsWith(glob.slice(0, -3));
        return rel.includes(glob);
      };
      const out: string[] = [];
      const files = listFilesTree("", 8).filter((n) => n.type === "file" && hitGlob(n.path) && (n.size ?? 0) < 1_000_000);
      for (const f of files.slice(0, 2000)) {
        const abs = resolveInWorkspace(f.path);
        const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < 100; i++) {
          re.lastIndex = 0;
          if (re.test(lines[i])) out.push(`${f.path}:${i + 1}:${lines[i].slice(0, 200)}`);
        }
        if (out.length >= 100) break;
      }
      return out.length
        ? out.join("\n") + (out.length >= 100 ? "\n……（已达 100 条上限，用 glob 收窄）" : "")
        : `未找到匹配「${query}」${glob ? `（glob ${glob}）` : ""}`;
    }

    case "todo_write": {
      const arr = call.args.todos;
      if (!Array.isArray(arr)) throw new Error("todos 必须是数组");
      const items = arr as TodoItem[];
      replaceTodos(ctx.threadId, items);
      const doing = items.filter((t) => t.status === "in_progress").length;
      const doneN = items.filter((t) => t.status === "completed").length;
      return `已更新任务清单：${items.length} 项（进行中 ${doing} / 完成 ${doneN}）`;
    }

    case "list_library": {
      const cats = db.prepare("SELECT id, name FROM categories ORDER BY id").all() as { id: number; name: string }[];
      const sources = db
        .prepare(
          `SELECT s.id, s.title, s.ext, s.status, s.chunk_count, c.name AS cat
           FROM sources s LEFT JOIN categories c ON c.id = s.category_id ORDER BY s.id DESC LIMIT 100`
        )
        .all() as Array<Record<string, unknown>>;
      const artifacts = db
        .prepare(
          `SELECT a.id, a.title, c.name AS cat FROM artifacts a
           LEFT JOIN categories c ON c.id = a.category_id ORDER BY a.id DESC LIMIT 60`
        )
        .all() as Array<Record<string, unknown>>;
      return JSON.stringify({ categories: cats, sources, artifacts }, null, 1);
    }

    case "read_source": {
      const id = Number(call.args.source_id);
      const src = db.prepare("SELECT id, title, status FROM sources WHERE id = ?").get(id) as
        | { id: number; title: string; status: string }
        | undefined;
      if (!src) throw new Error(`资料 #${id} 不存在`);
      const chunks = db
        .prepare("SELECT text FROM chunks WHERE source_id = ? ORDER BY idx")
        .all(id) as { text: string }[];
      if (!chunks.length) {
        return `《${src.title}》当前没有可用文本${src.status === "failed" ? "（入库失败）" : src.status === "processing" ? "（解析中）" : "（该类型不产生文本，如图片/音频）"}`;
      }
      const text = chunks.map((c) => c.text).join("\n\n");
      return `《${src.title}》完整文本（${chunks.length} 块，${text.length} 字）：\n\n${text.slice(0, 24000)}${text.length > 24000 ? "\n\n……（已截断）" : ""}`;
    }

    case "move_source": {
      const id = Number(call.args.source_id);
      const catId = call.args.category_id == null ? null : Number(call.args.category_id);
      const src = db.prepare("SELECT id, title FROM sources WHERE id = ?").get(id) as { id: number; title: string } | undefined;
      if (!src) throw new Error(`资料 #${id} 不存在`);
      if (catId != null) {
        const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
        if (!cat) throw new Error(`类目 #${catId} 不存在`);
      }
      db.prepare("UPDATE sources SET category_id = ? WHERE id = ?").run(catId, id);
      const catName = catId == null ? "未归类" : (db.prepare("SELECT name FROM categories WHERE id = ?").get(catId) as { name: string }).name;
      return `已把资料《${src.title}》移动到「${catName}」`;
    }

    case "move_artifact": {
      const id = Number(call.args.artifact_id);
      const catId = call.args.category_id == null ? null : Number(call.args.category_id);
      const art = db.prepare("SELECT id, title FROM artifacts WHERE id = ?").get(id) as { id: number; title: string } | undefined;
      if (!art) throw new Error(`产物 #${id} 不存在`);
      if (catId != null) {
        const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
        if (!cat) throw new Error(`类目 #${catId} 不存在`);
      }
      db.prepare("UPDATE artifacts SET category_id = ? WHERE id = ?").run(catId, id);
      const dest = catId == null ? "未归类" : `类目「${(db.prepare("SELECT name FROM categories WHERE id = ?").get(catId) as { name: string }).name}」`;
      return `已把产物《${art.title}》移动到 ${dest}`;
    }

    case "create_category": {
      const name = String(call.args.name ?? "").trim();
      if (!name) throw new Error("类目名不能为空");
      const dup = db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
      if (dup) throw new Error(`类目「${name}」已存在（#${(dup as { id: number }).id}）`);
      const info = db.prepare("INSERT INTO categories (name, created_at) VALUES (?, ?)").run(name, Date.now());
      return `已创建类目「${name}」（#${info.lastInsertRowid}）`;
    }

    case "generate_summary": {
      const ids = (call.args.source_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) throw new Error("请至少提供一个 source_id");
      const { title, content, model } = await generateSummary(ids);
      const info = db
        .prepare(
          "INSERT INTO artifacts (category_id, type, title, content, source_ids, model, created_at) VALUES (?, 'summary', ?, ?, ?, ?, ?)"
        )
        .run(null, title, content, JSON.stringify(ids), model, Date.now());
      return `已生成复习笔记《${title}》并存入未归类（产物 #${info.lastInsertRowid}，基于 ${ids.length} 份资料）。内容：\n\n${content.slice(0, 6000)}`;
    }

    case "web_search": {
      const q = String(call.args.query ?? "").trim();
      if (!q) throw new Error("缺少 query");
      const hits = await webSearch(q, 5);
      return hits.length ? webHitsToContext(hits) : `联网搜索「${q}」无结果（可能断网/被拦/关键词太冷门），按已有知识回答并告知学生未能联网`;
    }

    default:
      throw new Error(`未知工具：${call.name}`);
  }
}
