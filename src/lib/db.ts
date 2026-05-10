/**
 * Darwin V1 本地 SQLite — 单文件 db.ts
 *
 * 调试期 DB 一律走本地 SQLite,文件落在项目根 darwin.db (已 gitignore)。
 * Schema 在首次连接时自启,无需迁移工具。
 *
 * 切回 Supabase: 改 lib/projects.ts / lib/intents.ts 即可,db.ts 不外溢。
 *
 * Server-only — 永远不要从 Client Component 引这个文件。
 */

import Database from 'better-sqlite3';
import path from 'node:path';

let _db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('html','ppt','doc','design')),
  background TEXT,
  conflict_mode TEXT NOT NULL DEFAULT 'discuss' CHECK (conflict_mode IN ('discuss','ai_decide')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','collaborating','tension','converged','published')),
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
  ON projects (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'human' CHECK (author_kind IN ('human','agent')),
  statement TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Goal' CHECK (type IN ('Goal','Constraint','Preference','Reference','Veto')),
  scope TEXT NOT NULL DEFAULT 'global',
  weight TEXT NOT NULL DEFAULT 'should' CHECK (weight IN ('must','should','nice_to_have')),
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_intents_project_created
  ON intents (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  intent_ids TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_project_created
  ON versions (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human','agent')),
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  persona TEXT,
  cls TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_employees_owner_created
  ON employees (owner_id, created_at ASC);

CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_project ON project_collaborators (project_id);
CREATE INDEX IF NOT EXISTS idx_pc_employee ON project_collaborators (employee_id);

CREATE TABLE IF NOT EXISTS tensions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  intent_ids TEXT NOT NULL,           -- JSON array
  variant TEXT NOT NULL CHECK (variant IN ('human','agents')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  options TEXT NOT NULL,              -- JSON: [{key,title,desc}]
  resolution TEXT,                    -- JSON: {selectedOptionKey,decidedBy[],decidedAt,threadId?}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tensions_project_status
  ON tensions (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  tension_id TEXT,                    -- 软关联,Tension 删了不删讨论
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_threads_project ON threads (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_tension ON threads (tension_id);

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human','agent','system')),
  body TEXT NOT NULL,
  is_decision INTEGER NOT NULL DEFAULT 0,
  decision_payload TEXT,              -- JSON: {selectedOptionKey}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON thread_messages (thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS team_prefs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  source_cls TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_team_prefs_owner ON team_prefs (owner_id, created_at ASC);

CREATE TABLE IF NOT EXISTS pref_candidates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tension_id TEXT,                 -- 软关联,tension 删了仍保留候选历史
  thread_id TEXT,
  icon_key TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source_hint TEXT,                -- e.g. "hero 冲突 v3 · AI 仲裁"
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  accepted_pref_id TEXT,           -- 接受后写到 team_prefs.id, 反向追溯
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_pref_candidates_project_status
  ON pref_candidates (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pref_candidates_tension
  ON pref_candidates (tension_id);
`;

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

/** Seed the default human employee (徐鑫). Idempotent — re-runs are no-ops. */
function seedDefaultEmployee(conn: Database.Database) {
  conn
    .prepare(
      `INSERT OR IGNORE INTO employees
        (id, kind, name, short, role, email, cls, owner_id)
       VALUES (?, 'human', '徐鑫', '徐', 'PM', 'xuxin@deeplumen.com', 'xu', ?)`
    )
    .run(DEMO_OWNER_ID, DEMO_OWNER_ID);
}

/** Idempotent column migrations for already-existing tables. */
function ensureColumns(conn: Database.Database) {
  const versionsCols = conn
    .prepare(`PRAGMA table_info(versions)`)
    .all() as { name: string }[];
  if (!versionsCols.some(c => c.name === 'published_at')) {
    conn.exec(`ALTER TABLE versions ADD COLUMN published_at TEXT`);
  }

  const intentsCols = conn
    .prepare(`PRAGMA table_info(intents)`)
    .all() as { name: string }[];
  if (!intentsCols.some(c => c.name === 'trigger_intent_id')) {
    // 一条 Intent 是被哪条 Intent 触发的 (Agent react 的来源)。
    // null 表示自然产生 (Human 输入 / Agent 手动 speak)。
    // 注意: 不加 FK 约束, 因为旧 intent 可能被删, 不希望 cascade 删除新生 intent。
    conn.exec(`ALTER TABLE intents ADD COLUMN trigger_intent_id TEXT`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_intents_trigger ON intents(trigger_intent_id)`);
  }

  const empCols = conn
    .prepare(`PRAGMA table_info(employees)`)
    .all() as { name: string }[];
  if (!empCols.some(c => c.name === 'linked_human_id')) {
    // 数字员工 (real human 的 AI 替身) 通过 linked_human_id 指回真人 employee
    // null = 独立 Agent (Atlas/Lyra) 或真人本身
    conn.exec(`ALTER TABLE employees ADD COLUMN linked_human_id TEXT`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_employees_linked_human ON employees(linked_human_id)`);
  }
  if (!empCols.some(c => c.name === 'is_online')) {
    // 仅对真人有意义。Agent (含数字员工) 永远视作 online。
    conn.exec(`ALTER TABLE employees ADD COLUMN is_online INTEGER NOT NULL DEFAULT 1`);
  }
  if (!empCols.some(c => c.name === 'tags_json')) {
    // Agent 学习画像 — LLM 从它写过的 intent 抽出来的 ≤3 个短 tag,
    // 例: ["视觉敏感", "数据驱动"]. JSON.stringify(string[]).
    // 只对 agent 类有意义; human 行恒为 NULL。
    conn.exec(`ALTER TABLE employees ADD COLUMN tags_json TEXT`);
  }
  if (!empCols.some(c => c.name === 'tags_intent_count')) {
    // 上次抽 tags 时这个 agent 的 intent 数量, 用于判断是否需要重抽。
    conn.exec(`ALTER TABLE employees ADD COLUMN tags_intent_count INTEGER NOT NULL DEFAULT 0`);
  }
}

export function db(): Database.Database {
  if (_db) return _db;
  const dbPath =
    process.env.DARWIN_DB_PATH ||
    path.join(process.cwd(), 'darwin.db');
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(SCHEMA);
  ensureColumns(conn);
  seedDefaultEmployee(conn);
  _db = conn;
  return conn;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
