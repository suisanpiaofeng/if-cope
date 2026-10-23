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

/* ── 类目平权 + 子类目：AIGC 变为真实固定类目（pinned），产物默认落 AIGC；
 * 「未归类」= category_id 为 NULL 的统称（资源和产物都可以在未归类） */
const catCols = db.prepare("PRAGMA table_info(categories)").all() as { name: string }[];
if (!catCols.some((c) => c.name === "parent_id")) {
  db.exec("ALTER TABLE categories ADD COLUMN parent_id INTEGER");
}
if (!catCols.some((c) => c.name === "pinned")) {
  db.exec("ALTER TABLE categories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}

let aigcRow = db.prepare("SELECT id FROM categories WHERE pinned = 1 ORDER BY id LIMIT 1").get() as
  | { id: number }
  | undefined;
if (!aigcRow) {
  const byName = db.prepare("SELECT id FROM categories WHERE name = 'AIGC'").get() as { id: number } | undefined;
  if (byName) {
    db.prepare("UPDATE categories SET pinned = 1 WHERE id = ?").run(byName.id);
    aigcRow = byName;
  } else {
    const info = db.prepare("INSERT INTO categories (name, pinned, created_at) VALUES ('AIGC', 1, ?)").run(Date.now());
    aigcRow = { id: Number(info.lastInsertRowid) };
  }
}
// 历史产物（category_id 为 NULL）迁入 AIGC（仅当存在时，避免每次启动空跑 UPDATE）
const nullArtifacts = db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE category_id IS NULL").get() as { n: number };
if (nullArtifacts.n > 0) {
  db.prepare("UPDATE artifacts SET category_id = ? WHERE category_id IS NULL").run(aigcRow.id);
}

/** AIGC 固定类目的 id（AI 产物默认落点） */
export function getAigcCategoryId(): number | null {
  const row = db.prepare("SELECT id FROM categories WHERE pinned = 1 ORDER BY id LIMIT 1").get() as
    | { id: number }
    | undefined;
  return row?.id ?? null;
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
