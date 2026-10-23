import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "ifcope.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
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

export default db;
