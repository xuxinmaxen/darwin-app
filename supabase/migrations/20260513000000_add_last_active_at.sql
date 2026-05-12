-- Add last_active_at column for heartbeat-based online status
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_active_at TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_last_active ON employees (last_active_at);
