/**
 * 项目详情页 (V1) — Server Component
 *
 * 从 DB 拉项目元数据 + Intent 列表，把数据传给 ProjectShell（Client Component）。
 */

import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { describeClaudeConfig } from '@/lib/claude';
import ProjectShell from '@/components/ProjectShell';

type Params = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const intents = await listIntentsByProject(id);
  const claude = describeClaudeConfig();

  return (
    <ProjectShell
      project={project}
      intents={intents}
      claudeReady={claude.hasKey}
    />
  );
}
