-- Darwin V1 — Drop old incompatible schema, recreate clean.
-- The previous Supabase tables used a different structure (versions.snapshot,
-- tensions with title/description, project_collaborators with member_id etc.)
-- All real data lives in local SQLite; this is a fresh production deploy.

-- Drop old tables in reverse FK order
DROP TABLE IF EXISTS project_collaborators CASCADE;
DROP TABLE IF EXISTS versions CASCADE;
DROP TABLE IF EXISTS tensions CASCADE;
DROP TABLE IF EXISTS intents CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS threads CASCADE;
DROP TABLE IF EXISTS thread_messages CASCADE;
DROP TABLE IF EXISTS team_prefs CASCADE;
DROP TABLE IF EXISTS pref_candidates CASCADE;

-- ── Recreate with correct V1 schema ─────────────────────────────────────

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('html','ppt','doc','design')),
  background TEXT,
  conflict_mode TEXT NOT NULL DEFAULT 'discuss' CHECK (conflict_mode IN ('discuss','ai_decide')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','collaborating','tension','converged','published')),
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX idx_projects_owner_updated ON projects (owner_id, updated_at DESC);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human','agent')),
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
CREATE INDEX idx_employees_owner_created ON employees (owner_id, created_at ASC);
CREATE INDEX idx_employees_linked_human ON employees (linked_human_id);

CREATE TABLE intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'human' CHECK (author_kind IN ('human','agent')),
  statement TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Goal' CHECK (type IN ('Goal','Constraint','Preference','Reference','Veto')),
  scope TEXT NOT NULL DEFAULT 'global',
  weight TEXT NOT NULL DEFAULT 'should' CHECK (weight IN ('must','should','nice_to_have')),
  rationale TEXT,
  trigger_intent_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX idx_intents_project_created ON intents (project_id, created_at DESC);
CREATE INDEX idx_intents_trigger ON intents (trigger_intent_id);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  intent_ids TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX idx_versions_project_created ON versions (project_id, created_at DESC);

CREATE TABLE project_collaborators (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (project_id, employee_id)
);
CREATE INDEX idx_pc_project ON project_collaborators (project_id);
CREATE INDEX idx_pc_employee ON project_collaborators (employee_id);

CREATE TABLE tensions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  intent_ids TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('human','agents')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  options TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  resolved_at TEXT
);
CREATE INDEX idx_tensions_project_status ON tensions (project_id, status, created_at DESC);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  tension_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  resolved_at TEXT
);
CREATE INDEX idx_threads_project ON threads (project_id, created_at DESC);
CREATE INDEX idx_threads_tension ON threads (tension_id);

CREATE TABLE thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human','agent','system')),
  body TEXT NOT NULL,
  is_decision SMALLINT NOT NULL DEFAULT 0,
  decision_payload TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX idx_messages_thread ON thread_messages (thread_id, created_at ASC);

CREATE TABLE team_prefs (
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
CREATE INDEX idx_team_prefs_owner ON team_prefs (owner_id, created_at ASC);

CREATE TABLE pref_candidates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tension_id TEXT,
  thread_id TEXT,
  icon_key TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  accepted_pref_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX idx_pref_candidates_project_status ON pref_candidates (project_id, status, created_at DESC);
CREATE INDEX idx_pref_candidates_tension ON pref_candidates (tension_id);

-- ── Seed default owner ────────────────────────────────────────────────────

INSERT INTO employees (id, kind, name, short, role, email, cls, owner_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'human', '徐鑫', '徐', 'PM', 'xuxin@deeplumen.com', 'xu',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
