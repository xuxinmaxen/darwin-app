-- 项目级"导入参考 HTML"持久化 + 服务端合成状态快照
--
-- (A) reference_html:
--   用户在新建项目时选"导入已有链接",我们抓取的原始 HTML 落到这列。
--   合成 prompt 看到它就把它当作"复刻蓝本",AI 生成 v1 时以此为骨架。
--   不再走 seedHtml → 直接 createVersion 的旁路;所有版本都由 LLM 生成。
--
-- (B) synthesis_* 状态快照:
--   合成是后台 SSE,客户端刷新页面会断开连接但服务端仍在跑。
--   每隔 ~1.5s 把当前 partial HTML / 阶段 / thinking 文案写到 projects 表,
--   新客户端拉 GET /api/projects/:id/synthesize/job 就能无缝接力渲染。
--   completed_at 用来过期清理: 卡 5 分钟以上的 running 视为 zombie 强制收尾。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reference_html TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_partial_html TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_phase TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_thinking_msg TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_updated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS synthesis_error TEXT DEFAULT NULL;

-- 历史遗留: synthesis_running / synthesis_pending_intent_ids 已在上次迁移加过,这里不重复

CREATE INDEX IF NOT EXISTS idx_projects_synthesis_running
  ON projects(synthesis_running)
  WHERE synthesis_running = TRUE;
