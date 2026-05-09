/**
 * 项目详情页 (V1) — Server Component
 *
 * 拉项目元数据 + Intent 列表 + 最新一版合成结果,塞给 ProjectShell。
 */

import { notFound } from 'next/navigation';
import { getProject, listCollaborators } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { getLatestVersion, countVersions } from '@/lib/versions';
import { listActiveTensions } from '@/lib/tensions';
import { describeLLM } from '@/lib/llm';
import ProjectShell from '@/components/ProjectShell';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [intents, initialVersion, versionsTotal, collaborators, activeTensions] =
    await Promise.all([
      listIntentsByProject(id),
      getLatestVersion(id),
      countVersions(id),
      listCollaborators(id),
      listActiveTensions(id),
    ]);
  const llm = describeLLM();

  return (
    <ProjectShell
      project={project}
      intents={intents}
      claudeReady={llm.hasKey}
      initialVersion={initialVersion}
      versionsTotal={versionsTotal}
      collaborators={collaborators}
      activeTensions={activeTensions}
    />
  );
}
