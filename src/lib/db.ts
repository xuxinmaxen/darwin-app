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
