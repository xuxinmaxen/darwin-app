-- Darwin V1 — Initial migration (applied to Supabase with pre-existing old tables)
--
-- Strategy: CREATE TABLE IF NOT EXISTS for everything; old tables are skipped.
-- No FK constraints here (old tables have uuid IDs, new tables would fail type check).
-- The reset_to_v1 migration that follows drops everything and rebuilds with correct schema.
-- ALTER TABLE ADD COLUMN IF NOT EXISTS patches old tables for compatibility.

-- New tables only (old ones are skipped by IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  persona TEXT,
  cls TEXT NOT NULL,
  linked_human_id TEXT,
  is_online SMALLINT NOT NULL DEFAULT 1,
  tags_json TEXT,
  tags_intent_count INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- Tables that didn't exist before (no FKs to avoid uuid/text type conflict)
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tension_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  body TEXT NOT NULL,
  is_decision SMALLINT NOT NULL DEFAULT 0,
  decision_payload TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS team_prefs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  source_cls TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS pref_candidates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tension_id TEXT,
  thread_id TEXT,
  icon_key TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_pref_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- Backfill missing columns on pre-existing tables
ALTER TABLE intents   ADD COLUMN IF NOT EXISTS trigger_intent_id TEXT;
ALTER TABLE versions  ADD COLUMN IF NOT EXISTS published_at TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS linked_human_id TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_online SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tags_json TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tags_intent_count INTEGER NOT NULL DEFAULT 0;

-- Seed (will be overwritten by reset migration's proper seed)
INSERT INTO employees (id, kind, name, short, role, email, cls, owner_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'human', '徐鑫', '徐', 'PM', 'xuxin@deeplumen.com', 'xu',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
