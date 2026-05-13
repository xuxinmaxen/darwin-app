-- 持久化合成状态: 刷新页面后仍能恢复"合成中"界面
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS synthesis_running BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS synthesis_pending_intent_ids TEXT DEFAULT NULL;
-- synthesis_pending_intent_ids: JSON 数组, 存放本次合成捕获的 intentId 列表
-- 用于在客户端恢复时定位"生成中"分界线
