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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_project_created
  ON versions (project_id, created_at DESC);
`;

export function db(): Database.Database {
  if (_db) return _db;
  const dbPath =
    process.env.DARWIN_DB_PATH ||
    path.join(process.cwd(), 'darwin.db');
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(SCHEMA);
  _db = conn;
  return conn;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
