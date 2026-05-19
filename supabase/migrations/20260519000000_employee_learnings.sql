-- 发布后 Agent 学习沉淀
-- 一个 (employee, project) 一条; 同项目再发布 → UPSERT 刷新, 不堆历史
-- 时间戳 / id 格式跟 20260102000000_reset_to_v1.sql 一致 (TEXT id, ISO TEXT 时间戳, JSON 用 TEXT)

CREATE TABLE IF NOT EXISTS employee_learnings (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  highlights TEXT,  -- JSON-stringified string[]
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  UNIQUE (employee_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_learnings_employee_created ON employee_learnings (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON employee_learnings (project_id);
