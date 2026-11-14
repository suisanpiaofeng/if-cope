import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "ifcope.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  url TEXT,
  storage_name TEXT,
  sha256 TEXT NOT NULL,
  category_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  page INTEGER,
  idx INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

/* ── 课堂专区 v3（规格 docs/superpowers/specs/2026-11-09-classroom-native-ui-design.md §4）──
 * 多用户就绪：所有表带 user_id（本地 demo 恒为默认用户，D6 沿用）；
 * 旧 classroom_* 表（cvs_course_id 旧列）已在 2026-10-30 清空弃用；若仍存在且为空则删除重建。 */
const DEFAULT_USER = "local";
export { DEFAULT_USER };
for (const t of ["classroom_courses", "classroom_lessons", "classroom_notes", "classroom_digests"]) {
  // 并行构建的多个 worker 同时加载本模块，查存在→删表存在 TOCTOU 竞态：
  // A 查到表在、B 先删了，A 的 COUNT 会抛 no such table；整体 try/catch 容忍（删成功即目的达成）
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t) as
      | { name: string }
      | undefined;
    if (!has) continue;
    const { c } = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number };
    if (c === 0) db.exec(`DROP TABLE IF EXISTS ${t}`);
  } catch {
    /* 并发迁移中表已消失，忽略 */
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS agent_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_overrides (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS classroom_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  tecl_id TEXT NOT NULL,
  subj_id TEXT,
  subj_name TEXT NOT NULL,
  tecl_name TEXT,
  tecl_code TEXT,
  term TEXT,
  teac_names TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, tecl_id)
);
CREATE TABLE IF NOT EXISTS classroom_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES classroom_courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  cour_id TEXT NOT NULL,
  title TEXT NOT NULL,
  seq INTEGER NOT NULL,
  begin_time TEXT,
  vod_status INTEGER,
  duration_sec INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, cour_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_lessons_course ON classroom_lessons(course_id, seq);
`);

/* ── 索引 2.0：结构感知分块 + 混合检索（FTS5 关键词 + 向量，参考 Khoj/Quivr/LangChain） ──
 * heading 列：旧库迁移；chunks_fts：trigram 中文全文索引（external content + 触发器自动同步，
 * 业务层无需手动维护；rebuild 仅在首次建表时执行一次）。 */
const chunkCols = db.prepare("PRAGMA table_info(chunks)").all() as { name: string }[];
if (!chunkCols.some((c) => c.name === "heading")) {
  db.exec("ALTER TABLE chunks ADD COLUMN heading TEXT NOT NULL DEFAULT ''");
}

const ftsExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
  .get() as { name: string } | undefined;
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  heading,
  content='chunks',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
  INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;
`);
if (!ftsExists) {
  // 首次建表：从 chunks 存量回填（此后由触发器自动维护）
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
}

/* ── 类目：父子层级（parent_id）。「AIGC 固定类目」已于 2026-11-04 移除：
 *  生成的内容（笔记/地图等产物）默认落「未归类」（category_id NULL），可拖入任意类目；
 *  pinned 列仅为旧库兼容保留，不再使用。 */
const catCols = db.prepare("PRAGMA table_info(categories)").all() as { name: string }[];
if (!catCols.some((c) => c.name === "parent_id")) {
  db.exec("ALTER TABLE categories ADD COLUMN parent_id INTEGER");
}
if (!catCols.some((c) => c.name === "pinned")) {
  db.exec("ALTER TABLE categories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}

// 一次性迁移：解散历史 AIGC 固定类目（产物/资源回未归类，子类目提为顶级，删除该行）
const aigc = db
  .prepare("SELECT id FROM categories WHERE pinned = 1 OR name = 'AIGC' ORDER BY pinned DESC, id LIMIT 1")
  .get() as { id: number } | undefined;
if (aigc) {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE artifacts SET category_id = NULL WHERE category_id = ?").run(aigc.id);
    db.prepare("UPDATE sources SET category_id = NULL WHERE category_id = ?").run(aigc.id);
    db.prepare("UPDATE categories SET parent_id = NULL WHERE parent_id = ?").run(aigc.id);
    db.prepare("DELETE FROM categories WHERE id = ?").run(aigc.id);
    db.exec("COMMIT");
    console.log(`[db] 已解散 AIGC 固定类目（#${aigc.id}）：内容回未归类`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* 思考过程持久化：messages.reasoning 存深度思考模型的 reasoning_content（无则 NULL） */
const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!msgCols.some((c) => c.name === "reasoning")) {
  db.exec("ALTER TABLE messages ADD COLUMN reasoning TEXT");
}

/* 译文关联：sources.origin_id = 原文资源 id（type=翻译 的行专用），
 * 供翻译历史打开「原文↔译文对照」预览；旧译文行无此列时回退单栏展示 */
const srcCols = db.prepare("PRAGMA table_info(sources)").all() as { name: string }[];
if (!srcCols.some((c) => c.name === "origin_id")) {
  db.exec("ALTER TABLE sources ADD COLUMN origin_id INTEGER");
}

export type ModelSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
  /** 预留：iflink = 词来中转站；custom = 任意 OpenAI 兼容上游 */
  provider?: "iflink" | "custom";
  /** 固定向量维度，防止在不同 embedding 模型之间混用索引 */
  embeddingDimension?: number;
  verifiedAt?: number;
  /** 翻译用途上游（文献翻译专用独立接口；留空回退对话模型） */
  translateBaseUrl?: string;
  translateApiKey?: string;
  translateModel?: string;
  /** 用户级指令（个性化：AGENTS.md 式自由文本，运行时注入所有 LLM 场景） */
  userDirective?: string;
  /** 工作区根目录（harness P0；空 = 默认 data/workspace） */
  workspacePath?: string;
  /** 确认模式（harness P0）：writes=写操作需确认（默认）/ all=全部确认 / none=全自动 */
  confirmMode?: "writes" | "all" | "none";
  /** 命令策略（harness P1 §7.5）：normal=现状 / readonly=仅只读命令 / off=禁用 run_command */
  commandPolicy?: "normal" | "readonly" | "off";
  /** 生成参数（空 = 走模型默认） */
  temperature?: number;
  maxTokens?: number;
  /** 模型配置档（多档保存/切换；主字段始终为当前生效值） */
  profiles?: ModelProfile[];
  activeProfile?: string;
  /** MCP 服务器（harness P2 §9.3）：stdio 命令式接入 */
  mcpServers?: McpServerSetting[];
};

export type McpServerSetting = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type ModelProfile = {
  name: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  temperature?: number;
  maxTokens?: number;
};

const EMPTY: ModelSettings = {
  baseUrl: "",
  apiKey: "",
  chatModel: "",
  embedModel: "",
  provider: "custom",
  embeddingDimension: 0,
};

export function getSettings(): ModelSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("model") as
    | { value: string }
    | undefined;
  if (!row) return { ...EMPTY };
  try {
    const parsed = JSON.parse(row.value) as Partial<ModelSettings>;
    return {
      ...EMPTY,
      ...parsed,
      baseUrl: String(parsed.baseUrl ?? "").trim(),
      apiKey: String(parsed.apiKey ?? ""),
      chatModel: String(parsed.chatModel ?? "").trim(),
      embedModel: String(parsed.embedModel ?? "").trim(),
      embeddingDimension: Number(parsed.embeddingDimension ?? 0) || 0,
      translateBaseUrl: String(parsed.translateBaseUrl ?? "").trim(),
      translateApiKey: String(parsed.translateApiKey ?? ""),
      translateModel: String(parsed.translateModel ?? "").trim(),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function setSettings(s: ModelSettings) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(s));
}

export function isModelConfigured(s: ModelSettings = getSettings()): boolean {
  return Boolean(s.baseUrl && s.apiKey && s.chatModel);
}

export function recordUsage(
  action: string,
  model: string,
  promptTokens: number,
  completionTokens: number
) {
  db.prepare(
    "INSERT INTO usage_ledger (action, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    action,
    model,
    Math.max(0, Math.round(promptTokens)),
    Math.max(0, Math.round(completionTokens)),
    Date.now()
  );
}

/** 嵌入维度元数据自愈：以存量向量的实际维度为准校准设置。
 *  历史背景：bge-small-zh 实为 512 维，早期配置误记 384（与 bge-small-en 混淆）；
 *  检索本身以向量为准一直自洽，但换模型/重建索引时的维度校验会拿错误元数据误判，故在此校准。 */
const dimRow = db.prepare("SELECT embedding FROM chunks LIMIT 1").get() as { embedding: string } | undefined;
if (dimRow) {
  try {
    const actual = (JSON.parse(dimRow.embedding) as number[]).length;
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    if (raw) {
      const cfg = JSON.parse(raw.value) as { embeddingDimension?: number };
      if (actual > 0 && cfg.embeddingDimension !== actual) {
        cfg.embeddingDimension = actual;
        db.prepare("UPDATE settings SET value = ? WHERE key = 'model'").run(JSON.stringify(cfg));
      }
    }
  } catch {
    /* 元数据校准失败不影响启动，仅失去一次自愈机会 */
  }
}

export default db;
