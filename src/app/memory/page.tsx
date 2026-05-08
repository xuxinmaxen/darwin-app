/**
 * 团队记忆 — V2 占位页 (Server Component)
 *
 * 拉项目数量给 sidebar 计数。其余内容是 V2 预告。
 */

import { listProjects } from '@/lib/projects';
import V2StubShell from '@/components/V2StubShell';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export default async function MemoryPage() {
  let count = 0;
  try {
    const projects = await listProjects(DEMO_OWNER_ID);
    count = projects.length;
  } catch {
    // ignore — sidebar count is non-critical
  }

  return (
    <V2StubShell
      active="memory"
      projectsCount={count}
      eyebrow="团队记忆"
      title="组织级 AI 资产"
      description="每次冲突的解决、每个决策的取舍，都会自动沉淀为团队共识。新加入的 Agent 会读取这份记忆，第一天就懂团队脾气。"
      preview="V2 上线后，这里会沉淀：团队共识 (preferences) · Agent 学习状态 · 决策时间线。可一键导出为 Markdown，作为 Claude / GPT / Cursor 等 AI 工具的全局规范。"
    />
  );
}
