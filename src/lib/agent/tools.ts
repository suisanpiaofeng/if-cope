import db from "@/lib/db";
import { generateSummary } from "@/lib/artifact";
import { webSearch, webHitsToContext } from "@/lib/webSearch";

/** Agent 工具：OpenAI function calling 格式。
 *  定义（TOOLS）给模型看；executeTool（执行器）在服务端真实操作数据库。
 *  模型只传 id/参数，所有写操作都在这里做校验。 */

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

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
] as const;

/** 执行工具调用：返回给模型的文本结果；失败抛错（由调用方转成错误文本回喂模型） */
export async function executeTool(call: ToolCall): Promise<string> {
  switch (call.name) {
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
